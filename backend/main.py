from fastapi import FastAPI, HTTPException, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel
from typing import Dict, Any, Optional
from functools import lru_cache
import os
from pathlib import Path
from urllib.parse import quote_plus
from datetime import datetime, timedelta, timezone
import re
import psycopg2
from psycopg2.extras import RealDictCursor
import json
from jose import JWTError, jwt
from passlib.context import CryptContext

try:
    from langchain_community.agent_toolkits import create_sql_agent
    from langchain_community.utilities.sql_database import SQLDatabase
    from langchain_google_genai import ChatGoogleGenerativeAI
except ImportError:
    create_sql_agent = None
    SQLDatabase = None
    ChatGoogleGenerativeAI = None

app = FastAPI()

SECRET_KEY = os.getenv("JWT_SECRET_KEY", "change-this-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 12

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
fallback_pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/login")

allowed_origin_regex = os.getenv(
    "ALLOWED_ORIGIN_REGEX",
    r"https?://(localhost|127\.0\.0\.1)(:\d+)?|https://.*\.vercel\.app",
)

# Enable CORS so React (Port 3000) can talk to FastAPI (Port 8000)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=allowed_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def load_env_file():
    base_dir = Path(__file__).resolve().parent
    env_paths = [base_dir / ".env", base_dir.parent / ".env"]

    for env_path in env_paths:
        if not env_path.exists():
            continue

        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue

            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip("\"'")
            os.environ.setdefault(key, value)


load_env_file()

# Database connection settings
DB_SETTINGS = {
    "dbname": os.getenv("DB_NAME", "factory_db"),
    "user": os.getenv("DB_USER", "postgres"),
    "password": os.getenv("DB_PASSWORD", ""),
    "host": os.getenv("DB_HOST", "localhost"),
    "port": os.getenv("DB_PORT", "5433"),
}

def get_db_connection():
    return psycopg2.connect(**DB_SETTINGS)

# Define the expected format of incoming data
class ProductionData(BaseModel):
    plant_id: int
    production_date: str
    metrics: Dict[str, Any]


class NewField(BaseModel):
    name: str
    label: str
    type: str


class ChatQuery(BaseModel):
    question: str


def extract_llm_output_from_parse_error(error_text: str) -> Optional[str]:
    match = re.search(
        r"Could not parse LLM output:\s*`?(.*?)`?\s*(?:For troubleshooting|$)",
        error_text,
        flags=re.DOTALL,
    )
    if match:
        return match.group(1).strip().strip("`").strip()
    return None


def build_sqlalchemy_db_uri():
    user = quote_plus(str(DB_SETTINGS["user"]))
    password = quote_plus(str(DB_SETTINGS["password"]))
    host = DB_SETTINGS["host"]
    port = DB_SETTINGS["port"]
    dbname = quote_plus(str(DB_SETTINGS["dbname"]))
    return f"postgresql+psycopg2://{user}:{password}@{host}:{port}/{dbname}"


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return pwd_context.verify(normalize_bcrypt_password(plain_password), hashed_password)
    except Exception:
        try:
            return fallback_pwd_context.verify(plain_password, hashed_password)
        except Exception:
            return False


def get_password_hash(password: str) -> str:
    try:
        return pwd_context.hash(normalize_bcrypt_password(password))
    except Exception:
        return fallback_pwd_context.hash(password)


def normalize_bcrypt_password(password: str) -> bytes:
    return password.encode("utf-8")[:72]


def create_access_token(data: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def ensure_users_table(conn) -> None:
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'operator',
            plant_id INTEGER NOT NULL DEFAULT 3
        );
        """
    )
    conn.commit()
    cur.close()


def get_current_user(token: str = Depends(oauth2_scheme)) -> Dict[str, Any]:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        role = payload.get("role")
        plant_id = payload.get("plant_id")
        if username is None or role is None or plant_id is None:
            raise credentials_exception
        return {"username": username, "role": role, "plant_id": int(plant_id)}
    except (JWTError, ValueError):
        raise credentials_exception


@lru_cache(maxsize=1)
def get_agent_executor():
    if create_sql_agent is None or SQLDatabase is None or ChatGoogleGenerativeAI is None:
        raise RuntimeError(
            "AI dependencies are not installed. Install langchain, langchain-community, "
            "langchain-google-genai, and sqlalchemy in backend/.venv."
        )

    api_key = os.getenv("GOOGLE_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("GOOGLE_API_KEY is missing. Add it to your local .env file.")

    db = SQLDatabase.from_uri(build_sqlalchemy_db_uri())
    llm = ChatGoogleGenerativeAI(
        model=os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
        temperature=0,
        google_api_key=api_key,
    )
    return create_sql_agent(
        llm=llm,
        db=db,
        verbose=True,
        handle_parsing_errors=True,
    )

# --- ENDPOINTS ---

@app.get("/")
def read_root():
    return RedirectResponse(url="/docs")


@app.post("/login")
def login(form_data: OAuth2PasswordRequestForm = Depends()):
    try:
        conn = get_db_connection()
        ensure_users_table(conn)
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            "SELECT username, password_hash, role, plant_id FROM users WHERE username = %s;",
            (form_data.username,),
        )
        user = cur.fetchone()
        cur.close()
        conn.close()

        if user is None or not verify_password(form_data.password, user["password_hash"]):
            raise HTTPException(status_code=401, detail="Incorrect username or password")

        access_token = create_access_token(
            data={"sub": user["username"], "role": user["role"], "plant_id": user["plant_id"]}
        )
        return {
            "access_token": access_token,
            "token_type": "bearer",
            "user": {
                "username": user["username"],
                "role": user["role"],
                "plant_id": user["plant_id"],
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/schema/{plant_id}")
def get_schema(plant_id: int, current_user: Dict[str, Any] = Depends(get_current_user)):
    try:
        if current_user["role"] != "admin" and current_user["plant_id"] != plant_id:
            raise HTTPException(status_code=403, detail="Forbidden for this plant")
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SELECT form_schema FROM plant_schemas WHERE plant_id = %s;", (plant_id,))
        result = cur.fetchone()
        cur.close()
        conn.close()

        if result is None:
            raise HTTPException(status_code=404, detail="Plant not found")
            
        return result["form_schema"]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/schema/{plant_id}/add-field")
def add_field_to_schema(plant_id: int, field: NewField, current_user: Dict[str, Any] = Depends(get_current_user)):
    try:
        if current_user["role"] != "admin" and current_user["plant_id"] != plant_id:
            raise HTTPException(status_code=403, detail="Forbidden for this plant")
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SELECT form_schema FROM plant_schemas WHERE plant_id = %s;", (plant_id,))
        result = cur.fetchone()

        if result is None:
            raise HTTPException(status_code=404, detail="Plant not found")

        schema = result["form_schema"] or {}
        fields = schema.get("fields")
        if not isinstance(fields, list):
            fields = []

        field_payload = field.model_dump()
        duplicate = next((item for item in fields if item.get("name") == field_payload["name"]), None)
        if duplicate is not None:
            raise HTTPException(status_code=400, detail="Field name already exists for this plant")

        fields.append(field_payload)
        schema["fields"] = fields

        cur.execute(
            "UPDATE plant_schemas SET form_schema = %s::jsonb WHERE plant_id = %s;",
            (json.dumps(schema), plant_id),
        )
        conn.commit()
        cur.close()
        conn.close()
        return {"status": "success", "form_schema": schema}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/schema/{plant_id}/remove-field/{field_name}")
def remove_field_from_schema(plant_id: int, field_name: str, current_user: Dict[str, Any] = Depends(get_current_user)):
    try:
        if current_user["role"] != "admin" and current_user["plant_id"] != plant_id:
            raise HTTPException(status_code=403, detail="Forbidden for this plant")
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SELECT form_schema FROM plant_schemas WHERE plant_id = %s;", (plant_id,))
        result = cur.fetchone()

        if result is None:
            raise HTTPException(status_code=404, detail="Plant not found")

        schema = result["form_schema"] or {}
        fields = schema.get("fields")
        if not isinstance(fields, list):
            fields = []

        filtered_fields = [item for item in fields if item.get("name") != field_name]
        if len(filtered_fields) == len(fields):
            raise HTTPException(status_code=404, detail="Field not found for this plant")

        schema["fields"] = filtered_fields
        cur.execute(
            "UPDATE plant_schemas SET form_schema = %s::jsonb WHERE plant_id = %s;",
            (json.dumps(schema), plant_id),
        )
        conn.commit()
        cur.close()
        conn.close()
        return {"status": "success", "form_schema": schema}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/data/submit")
def submit_data(data: ProductionData, current_user: Dict[str, Any] = Depends(get_current_user)):
    try:
        if current_user["role"] != "admin" and current_user["plant_id"] != data.plant_id:
            raise HTTPException(status_code=403, detail="Forbidden for this plant")
        conn = get_db_connection()
        cur = conn.cursor()
        
        # Upsert daily JSON data by plant/date
        cur.execute(
            """
            INSERT INTO production_data (plant_id, production_date, metrics)
            VALUES (%s, %s, %s)
            ON CONFLICT (plant_id, production_date)
            DO UPDATE SET metrics = EXCLUDED.metrics;
            """,
            (data.plant_id, data.production_date, json.dumps(data.metrics)),
        )
        conn.commit() # Don't forget to commit!
        
        cur.close()
        conn.close()
        return {"status": "success", "message": "Data securely saved to PostgreSQL"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/data/{plant_id}/{production_date}")
def get_data_for_day(plant_id: int, production_date: str, current_user: Dict[str, Any] = Depends(get_current_user)):
    try:
        if current_user["role"] != "admin" and current_user["plant_id"] != plant_id:
            raise HTTPException(status_code=403, detail="Forbidden for this plant")
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            """
            SELECT metrics
            FROM production_data
            WHERE plant_id = %s AND production_date = %s;
            """,
            (plant_id, production_date),
        )
        result = cur.fetchone()
        cur.close()
        conn.close()

        if result is None:
            return {"metrics": {}}

        return {"metrics": result.get("metrics") or {}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/dashboard/unidil")
def get_dashboard_data(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: Dict[str, Any] = Depends(get_current_user),
):
    try:
        if current_user["role"] != "admin" and current_user["plant_id"] != 3:
            raise HTTPException(status_code=403, detail="Forbidden for this plant")
        def to_float_metric(raw_value: Any) -> float:
            if raw_value in ("", None):
                return 0.0
            try:
                return float(raw_value)
            except (TypeError, ValueError):
                return 0.0

        today = datetime.today().date()
        parsed_end_date = datetime.strptime(end_date, "%Y-%m-%d").date() if end_date else today
        parsed_start_date = datetime.strptime(start_date, "%Y-%m-%d").date() if start_date else (today - timedelta(days=7))

        if parsed_start_date > parsed_end_date:
            raise HTTPException(status_code=400, detail="start_date cannot be after end_date")

        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            """
            SELECT production_date, metrics
            FROM production_data
            WHERE plant_id = 3
              AND production_date >= %s
              AND production_date <= %s
            ORDER BY production_date ASC;
            """,
            (parsed_start_date, parsed_end_date),
        )
        results = cur.fetchall()
        cur.close()
        conn.close()

        chart_data = []
        for row in results:
            metrics = row.get("metrics") or {}
            date_value = row.get("production_date")
            date_str = date_value.strftime("%b %d") if date_value else ""

            chart_data.append(
                {
                    "date": date_str,
                    "Corrugator Yield (%)": to_float_metric(metrics.get("yield_corrugator_pct", 0)),
                    "Tuber Yield (%)": to_float_metric(metrics.get("yield_tuber_pct", 0)),
                    "Corrugator Downtime (min)": to_float_metric(metrics.get("stoppages_corrugator_min", 0)),
                    "Tuber Downtime (min)": to_float_metric(metrics.get("stoppages_tuber_min", 0)),
                }
            )

        return chart_data
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD for start_date and end_date.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/chat")
def chat_with_data(query: ChatQuery, current_user: Dict[str, Any] = Depends(get_current_user)):
    agent_executor = get_agent_executor()
    custom_prompt = f"""
You are a helpful factory data analyst.
The user is asking: "{query.question}"

Important rules:
- Use the SQL tools to inspect available tables before answering.
- The production_data.metrics column stores JSON/JSONB-style plant metrics.
- Check plant_schemas when you need to understand which metric keys exist for each plant.
- Never make INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, or other write operations.
- Answer based only on the database results you retrieve.
"""
    try:
        response = agent_executor.invoke({"input": custom_prompt})
        return {"answer": response["output"]}
    except Exception as e:
        error_text = str(e)
        is_parse_failure = "OUTPUT_PARSING_FAILURE" in error_text or "Could not parse LLM output" in error_text

        if is_parse_failure:
            extracted_answer = extract_llm_output_from_parse_error(error_text)
            if extracted_answer:
                return {"answer": extracted_answer}

            retry_prompt = (
                f"{custom_prompt}\n\n"
                "Return the final response in exactly this format:\n"
                "Final Answer: <your answer>"
            )
            try:
                retry_response = agent_executor.invoke({"input": retry_prompt})
                retry_output = retry_response.get("output", "")
                if isinstance(retry_output, str) and retry_output.lower().startswith("final answer:"):
                    retry_output = retry_output.split(":", 1)[1].strip()
                return {"answer": retry_output or "I hit a formatting issue, but the query can be retried."}
            except Exception:
                return {"answer": "I hit a response-formatting issue. Please try rephrasing your question."}

        raise HTTPException(status_code=500, detail=str(e))
