import {
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from "recharts";
import React, { useState, useEffect, useMemo } from "react";
const isLocalHost = window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost";

const API_BASE_CANDIDATES = isLocalHost
  ? ["http://127.0.0.1:8001", "http://127.0.0.1:8000", "https://backend-nine-murex-11.vercel.app"]
  : ["https://backend-nine-murex-11.vercel.app"];

async function apiFetch(path, options = {}, userToken = "") {
  const mergedHeaders = { ...(options.headers || {}) };
  if (userToken) {
    mergedHeaders.Authorization = `Bearer ${userToken}`;
  }

  const requestOptions = { ...options, headers: mergedHeaders };
  let lastNetworkError = null;

  for (const baseUrl of API_BASE_CANDIDATES) {
    try {
      return await fetch(`${baseUrl}${path}`, requestOptions);
    } catch (err) {
      lastNetworkError = err;
    }
  }

  throw lastNetworkError || new Error("Backend is not reachable");
}

function DynamicPlantForm({ plantId, userToken }) {
  const [schema, setSchema] = useState(null);
  const [formData, setFormData] = useState({});
  const [productionDate, setProductionDate] = useState(new Date().toISOString().split("T")[0]);
  const [error, setError] = useState("");
  const [isAddingField, setIsAddingField] = useState(false);
  const [newField, setNewField] = useState({ name: "", label: "", type: "number" });

  const fetchSchema = async () => {
    try {
      const response = await apiFetch(`/schema/${plantId}`, {}, userToken);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || "Failed to load schema");
      }
      setSchema(Array.isArray(data.fields) ? data.fields : []);
      setFormData({});
      setError("");
    } catch (err) {
      console.error("Failed to load schema", err);
      setSchema(null);
      setError(err.message || "Failed to load schema");
    }
  };

  useEffect(() => {
    fetchSchema();
  }, [plantId]);

  useEffect(() => {
    const fetchExistingDataForDate = async () => {
      try {
        const response = await apiFetch(`/data/${plantId}/${productionDate}`, {}, userToken);
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.detail || "Failed to load existing production data");
        }
        setFormData(data && typeof data.metrics === "object" && data.metrics !== null ? data.metrics : {});
      } catch (err) {
        console.error("Failed to load existing production data", err);
        setFormData({});
      }
    };

    fetchExistingDataForDate();
  }, [plantId, productionDate]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value === "" ? "" : value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const response = await apiFetch(`/data/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plant_id: plantId,
          production_date: productionDate,
          metrics: formData
        })
      }, userToken);
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.detail || "Error submitting data");
      }
      alert(result.message || "Submitted");
      setFormData({});
    } catch (err) {
      alert(err.message || "Error submitting data!");
    }
  };

  const handleRemoveField = async (field) => {
    const confirmed = window.confirm(`Remove field "${field.label}" from this plant schema?`);
    if (!confirmed) {
      return;
    }

    try {
      const response = await apiFetch(`/schema/${plantId}/remove-field/${encodeURIComponent(field.name)}`, {
        method: "DELETE"
      }, userToken);
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 404 && result.detail === "Not Found") {
          throw new Error("Remove-field API not available. Restart backend on port 8001 and try again.");
        }
        throw new Error(result.detail || "Failed to remove field");
      }

      const updatedFormData = { ...formData };
      delete updatedFormData[field.name];
      setFormData(updatedFormData);
      await fetchSchema();
    } catch (err) {
      alert(err.message || "Failed to remove field");
    }
  };

  const handleAddNewField = async (e) => {
    e.preventDefault();

    const trimmedLabel = newField.label.trim();
    if (!trimmedLabel) {
      alert("Field label is required.");
      return;
    }

    const generatedName = trimmedLabel
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

    if (!generatedName) {
      alert("Please use a valid field label.");
      return;
    }

    try {
      const response = await apiFetch(`/schema/${plantId}/add-field`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: generatedName,
          label: trimmedLabel,
          type: newField.type
        })
      }, userToken);

      const result = await response.json();
      if (!response.ok) {
        if (response.status === 404 && result.detail === "Not Found") {
          throw new Error("Add-field API not available. Restart backend on port 8001 and try again.");
        }
        throw new Error(result.detail || "Failed to add field");
      }

      setNewField({ name: "", label: "", type: "number" });
      setIsAddingField(false);
      await fetchSchema();
    } catch (err) {
      alert(err.message || "Failed to add field");
    }
  };

  if (error) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
        Error: {error}
      </div>
    );
  }

  if (schema === null) {
    return <p className="text-slate-600">Loading secure form...</p>;
  }

  const corrugatorFields = schema.filter((field) => field.name?.includes("corrugator"));
  const tuberFields = schema.filter((field) => field.name?.includes("tuber"));
  const otherFields = schema.filter((field) => !field.name?.includes("corrugator") && !field.name?.includes("tuber"));

  const renderFieldCard = (title, subtitle, fields, accentClass) => (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex items-center justify-between sm:mb-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
          <p className="text-xs text-slate-500">{subtitle}</p>
        </div>
        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${accentClass}`}>
          {fields.length} fields
        </span>
      </div>

      {fields.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
          No fields in this section.
        </p>
      ) : (
        <div className="space-y-3.5 sm:space-y-4">
          {fields.map((field) => (
            <div key={field.name}>
              <div className="mb-2 flex items-center justify-between gap-3">
                <label className="text-sm font-medium text-slate-700">{field.label}</label>
                <button
                  type="button"
                  onClick={() => handleRemoveField(field)}
                  className="rounded-md bg-rose-600 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-rose-700 focus:outline-none focus:ring-2 focus:ring-rose-400 focus:ring-offset-1"
                >
                  Remove
                </button>
              </div>
              <input
                type={field.type}
                name={field.name}
                value={formData[field.name] || ""}
                onChange={handleChange}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-5 lg:space-y-6">
      {schema.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white p-4 text-slate-600 shadow-sm">
          No schema found for this plant yet.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5 lg:space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <label className="mb-2 block text-sm font-semibold text-slate-800">Production Date</label>
            <input
              type="date"
              value={productionDate}
              onChange={(e) => setProductionDate(e.target.value)}
              required
              className="w-full max-w-xs rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
            />
          </div>

          <p className="text-sm text-slate-600">Note: Leave fields blank if data is N/A.</p>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 xl:gap-5">
            {renderFieldCard(
              "Corrugator Metrics",
              "Planned, actual, yield, rejections, and stoppages",
              corrugatorFields,
              "bg-blue-100 text-blue-700"
            )}
            {renderFieldCard(
              "Tuber Metrics",
              "Planned, actual, yield, rejections, and stoppages",
              tuberFields,
              "bg-cyan-100 text-cyan-700"
            )}
            {renderFieldCard(
              "Other / General",
              "Printing, finishing, and custom machine fields",
              otherFields,
              "bg-slate-100 text-slate-700"
            )}
          </div>

          <button
            type="submit"
            className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
          >
            Submit Production Data
          </button>
        </form>
      )}

      <div className="rounded-xl border border-slate-200 bg-gray-100 p-4 shadow-inner sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Builder / Admin Zone</h3>
            <p className="text-xs text-slate-600">Add custom fields to this plant schema.</p>
          </div>
          {!isAddingField && (
            <button
              type="button"
              onClick={() => setIsAddingField(true)}
              className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
            >
              + Add New Data Field
            </button>
          )}
        </div>

        {isAddingField && (
          <form onSubmit={handleAddNewField} className="space-y-4 rounded-lg border border-slate-300 bg-white p-3.5 sm:p-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Field Label</label>
              <input
                type="text"
                value={newField.label}
                onChange={(e) => setNewField({ ...newField, label: e.target.value })}
                placeholder="e.g., Shift Temperature"
                required
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Data Type</label>
              <select
                value={newField.type}
                onChange={(e) => setNewField({ ...newField, type: e.target.value })}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
              >
                <option value="number">Number</option>
                <option value="text">Text</option>
              </select>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
              >
                Save Field
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsAddingField(false);
                  setNewField({ name: "", label: "", type: "number" });
                }}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function FactoryChatbot({ userToken }) {
  const [question, setQuestion] = useState("");
  const [chatLog, setChatLog] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  const handleAsk = async (e) => {
    e.preventDefault();
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion || isLoading) {
      return;
    }

    const nextLog = [...chatLog, { sender: "user", text: trimmedQuestion }];
    setChatLog(nextLog);
    setQuestion("");
    setIsLoading(true);

    try {
      const response = await apiFetch(`/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmedQuestion })
      }, userToken);
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.detail || "AI request failed");
      }

      setChatLog([...nextLog, { sender: "ai", text: result.answer || "No answer returned." }]);
    } catch (err) {
      setChatLog([...nextLog, { sender: "ai", text: err.message || "Connection error with AI brain." }]);
    }

    setIsLoading(false);
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <h2 className="mb-4 text-lg font-semibold text-slate-900 sm:text-xl">Factory AI Assistant</h2>

      <div className="mb-4 h-52 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3 sm:h-56">
        {chatLog.length === 0 && (
          <p className="text-sm text-slate-500">Ask about plant schemas, production trends, or submitted metrics.</p>
        )}
        <div className="space-y-3">
          {chatLog.map((msg, i) => (
            <div key={i} className={msg.sender === "user" ? "text-right" : "text-left"}>
              <span
                className={
                  msg.sender === "user"
                    ? "inline-block max-w-[85%] rounded-2xl bg-blue-600 px-3 py-2 text-sm text-white"
                    : "inline-block max-w-[85%] rounded-2xl bg-slate-200 px-3 py-2 text-sm text-slate-800"
                }
              >
                {msg.text}
              </span>
            </div>
          ))}
          {isLoading && <p className="text-sm italic text-slate-500">Agent is analyzing the database...</p>}
        </div>
      </div>

      <form onSubmit={handleAsk} className="flex flex-col gap-2.5 sm:flex-row">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g., What schema fields exist for UNIDIL?"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
        />
        <button
          type="submit"
          disabled={isLoading}
          className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Ask Data
        </button>
      </form>
    </div>
  );
}

function UnidilDashboard({ userToken }) {
  const today = new Date();
  const defaultEndDate = today.toISOString().split("T")[0];
  const startSeed = new Date(today);
  startSeed.setDate(startSeed.getDate() - 7);
  const defaultStartDate = startSeed.toISOString().split("T")[0];

  const [chartData, setChartData] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const [selectedMachine, setSelectedMachine] = useState("corrugator");
  const [selectedMetric, setSelectedMetric] = useState("actual_vs_planned");
  const [appliedFilter, setAppliedFilter] = useState({ startDate: defaultStartDate, endDate: defaultEndDate });

  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        setIsLoading(true);
        setError("");
        const params = new URLSearchParams({
          start_date: appliedFilter.startDate,
          end_date: appliedFilter.endDate
        });
        const response = await apiFetch(`/api/dashboard/unidil?${params.toString()}`, {}, userToken);
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.detail || "Failed to load dashboard data");
        }
        setChartData(Array.isArray(data) ? data : []);
      } catch (err) {
        setError(err.message || "Failed to load dashboard data");
      } finally {
        setIsLoading(false);
      }
    };

    fetchDashboardData();
  }, [appliedFilter]);

  const handleApplyFilter = () => {
    if (startDate > endDate) {
      setError("Start Date cannot be after End Date.");
      return;
    }

    setError("");
    setAppliedFilter({ startDate, endDate });
  };

  const metricKeyCandidates = useMemo(
    () => ({
      actual_vs_planned: {
        corrugator: {
          planned: ["planned_corrugator_mt", "corrugator_planned_mt"],
          actual: ["actual_corrugator_mt", "corrugator_actual_mt"]
        },
        tuber: {
          planned: ["planned_tuber_mt", "tuber_planned_mt"],
          actual: ["actual_tuber_mt", "tuber_actual_mt"]
        },
        printing: {
          planned: ["planned_printing_mt", "printing_planned_mt"],
          actual: ["actual_printing_mt", "printing_actual_mt"]
        },
        finishing: {
          planned: ["planned_finishing_mt", "finishing_planned_mt"],
          actual: ["actual_finishing_mt", "finishing_actual_mt"]
        }
      },
      yield: {
        corrugator: ["yield_corrugator_pct", "corrugator_yield_pct", "Corrugator Yield (%)"],
        tuber: ["yield_tuber_pct", "tuber_yield_pct", "Tuber Yield (%)"],
        printing: ["yield_printing_pct", "printing_yield_pct", "Printing Yield (%)"],
        finishing: ["yield_finishing_pct", "finishing_yield_pct", "Finishing Yield (%)"]
      },
      stoppages: {
        corrugator: ["stoppages_corrugator_min", "corrugator_stoppages_min", "Corrugator Downtime (min)"],
        tuber: ["stoppages_tuber_min", "tuber_stoppages_min", "Tuber Downtime (min)"],
        printing: ["stoppages_printing_min", "printing_stoppages_min", "Printing Downtime (min)"],
        finishing: ["stoppages_finishing_min", "finishing_stoppages_min", "Finishing Downtime (min)"]
      },
      rejections: {
        corrugator: ["rejections_corrugator_mt", "corrugator_rejections_mt", "rejected_corrugator_mt"],
        tuber: ["rejections_tuber_mt", "tuber_rejections_mt", "rejected_tuber_mt"],
        printing: ["rejections_printing_mt", "printing_rejections_mt", "rejected_printing_mt"],
        finishing: ["rejections_finishing_mt", "finishing_rejections_mt", "rejected_finishing_mt"]
      }
    }),
    []
  );

  const getFirstNumericValue = (row, candidates) => {
    for (const key of candidates) {
      const rawValue = row?.[key];
      if (rawValue === "" || rawValue === null || rawValue === undefined) {
        continue;
      }
      const parsed = Number(rawValue);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
    return null;
  };

  const formattedChartData = useMemo(() => {
    const selectedConfig = metricKeyCandidates[selectedMetric]?.[selectedMachine];
    if (!selectedConfig) {
      return [];
    }

    return chartData.map((row) => {
      const base = { date: row.date };

      if (selectedMetric === "actual_vs_planned") {
        const plannedValue = getFirstNumericValue(row, selectedConfig.planned || []);
        const actualValue = getFirstNumericValue(row, selectedConfig.actual || []);
        return {
          ...base,
          planned: plannedValue,
          actual: actualValue
        };
      }

      const value = getFirstNumericValue(row, selectedConfig || []);
      return {
        ...base,
        value
      };
    });
  }, [chartData, selectedMetric, selectedMachine, metricKeyCandidates]);

  const isMetricAvailableForSelection = useMemo(() => {
    if (!formattedChartData.length) {
      return false;
    }

    if (selectedMetric === "actual_vs_planned") {
      return formattedChartData.some((entry) => entry.planned !== null || entry.actual !== null);
    }

    return formattedChartData.some((entry) => entry.value !== null);
  }, [formattedChartData, selectedMetric]);

  const machineLabel = selectedMachine.charAt(0).toUpperCase() + selectedMachine.slice(1);
  const metricTitleMap = {
    actual_vs_planned: `${machineLabel} Actual vs Planned (MT)`,
    yield: `${machineLabel} Yield Trend (%)`,
    stoppages: `${machineLabel} Stoppages (min)`,
    rejections: `${machineLabel} Rejections (MT)`
  };

  const filterBar = (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-sm font-medium text-slate-700">
            <span className="mb-1 block">Start Date</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm outline-none transition hover:border-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            <span className="mb-1 block">End Date</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm outline-none transition hover:border-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            <span className="mb-1 block">Select Machine</span>
            <select
              value={selectedMachine}
              onChange={(e) => setSelectedMachine(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-slate-900 shadow-sm outline-none transition hover:bg-slate-100 focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
            >
              <option value="corrugator">Corrugator</option>
              <option value="tuber">Tuber</option>
              <option value="printing">Printing</option>
              <option value="finishing">Finishing</option>
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-700">
            <span className="mb-1 block">Select Metric</span>
            <select
              value={selectedMetric}
              onChange={(e) => setSelectedMetric(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-slate-900 shadow-sm outline-none transition hover:bg-slate-100 focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
            >
              <option value="actual_vs_planned">Actual vs Planned</option>
              <option value="yield">Yield</option>
              <option value="stoppages">Stoppages</option>
              <option value="rejections">Rejections</option>
            </select>
          </label>
        </div>

        <button
          type="button"
          onClick={handleApplyFilter}
          className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-300 lg:w-auto"
        >
          Apply Filter
        </button>
      </div>
    </div>
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        {filterBar}
        <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
          Loading analytics dashboard...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        {filterBar}
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700 shadow-sm">
          Error: {error}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {filterBar}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-md sm:p-5">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">{metricTitleMap[selectedMetric]}</h3>
        {!isMetricAvailableForSelection ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-600">
            Data metric not tracked for this machine.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={380}>
            {selectedMetric === "actual_vs_planned" ? (
              <BarChart data={formattedChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="planned" name="Planned (MT)" fill="#6366f1" radius={[6, 6, 0, 0]} />
                <Bar dataKey="actual" name="Actual (MT)" fill="#0ea5e9" radius={[6, 6, 0, 0]} />
              </BarChart>
            ) : null}
            {selectedMetric === "yield" ? (
              <LineChart data={formattedChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="value" name="Yield (%)" stroke="#2563eb" strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            ) : null}
            {selectedMetric === "stoppages" ? (
              <AreaChart data={formattedChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="value"
                  name="Stoppages (min)"
                  stroke="#ea580c"
                  fill="#fdba74"
                  strokeWidth={2}
                />
              </AreaChart>
            ) : null}
            {selectedMetric === "rejections" ? (
              <BarChart data={formattedChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="value" name="Rejections (MT)" fill="#ef4444" radius={[6, 6, 0, 0]} />
              </BarChart>
            ) : null}
          </ResponsiveContainer>
        )}
        {!chartData.length && !isLoading && !error && (
          <p className="mt-4 text-sm text-slate-500">No dashboard records found for the selected date range.</p>
        )}
      </div>
    </div>
  );
}

function LoginScreen({ username, password, onUsernameChange, onPasswordChange, onSubmit, isLoading, error }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-lg sm:p-7">
        <h1 className="text-2xl font-bold text-slate-900">Factory Login</h1>
        <p className="mt-1 text-sm text-slate-600">Sign in to access the command center.</p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => onUsernameChange(e.target.value)}
              required
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => onPasswordChange(e.target.value)}
              required
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
            />
          </div>
          {error && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? "Signing In..." : "Login"}
          </button>
        </form>
      </div>
    </div>
  );
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userToken, setUserToken] = useState("");
  const [currentUser, setCurrentUser] = useState(null);
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [selectedPlant, setSelectedPlant] = useState(3);
  const [activeView, setActiveView] = useState("data-entry");

  useEffect(() => {
    const storedToken = localStorage.getItem("factory_access_token");
    const storedUser = localStorage.getItem("factory_current_user");
    if (storedToken) {
      setUserToken(storedToken);
      setIsAuthenticated(true);
      if (storedUser) {
        try {
          const parsedUser = JSON.parse(storedUser);
          setCurrentUser(parsedUser);
          if (parsedUser?.plant_id) {
            setSelectedPlant(parsedUser.plant_id);
          }
        } catch {
          setCurrentUser(null);
        }
      }
    }
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError("");
    setIsLoggingIn(true);

    const formData = new URLSearchParams();
    formData.append("username", loginUsername);
    formData.append("password", loginPassword);

    try {
      let response;
      try {
        response = await fetch("http://localhost:8000/login", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: formData.toString()
        });
      } catch {
        response = await apiFetch(
          "/login",
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: formData.toString()
          },
          ""
        );
      }

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.detail || "Login failed");
      }

      const token = result.access_token || "";
      const user = result.user || null;
      if (!token) {
        throw new Error("Access token missing from login response");
      }

      localStorage.setItem("factory_access_token", token);
      localStorage.setItem("factory_current_user", JSON.stringify(user || {}));
      setUserToken(token);
      setCurrentUser(user);
      setIsAuthenticated(true);
      if (user?.plant_id) {
        setSelectedPlant(user.plant_id);
      }
      setLoginPassword("");
    } catch (err) {
      setLoginError(err.message || "Login failed");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("factory_access_token");
    localStorage.removeItem("factory_current_user");
    setIsAuthenticated(false);
    setUserToken("");
    setCurrentUser(null);
    setLoginPassword("");
    setLoginError("");
  };

  if (!isAuthenticated) {
    return (
      <LoginScreen
        username={loginUsername}
        password={loginPassword}
        onUsernameChange={setLoginUsername}
        onPasswordChange={setLoginPassword}
        onSubmit={handleLogin}
        isLoading={isLoggingIn}
        error={loginError}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-6 text-slate-900 sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-5 lg:space-y-6">
        <header className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="mb-4">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Factory Command Center</h1>
            <p className="mt-1 text-sm text-slate-600 sm:text-base">Select your plant to enter production data.</p>
          </div>
          <button
            onClick={() => setSelectedPlant(3)}
            className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-300"
          >
            UNIDIL
          </button>
          {currentUser && (
            <p className="mt-2 text-xs text-slate-500">
              Signed in as <span className="font-semibold">{currentUser.username}</span>
            </p>
          )}
        </header>

        <nav className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <button
            onClick={() => setActiveView("data-entry")}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-offset-1 ${
              activeView === "data-entry"
                ? "bg-blue-600 text-white focus:ring-blue-300"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200 focus:ring-slate-300"
            }`}
          >
            Data Entry
          </button>
          <button
            onClick={() => setActiveView("dashboard")}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-offset-1 ${
              activeView === "dashboard"
                ? "bg-blue-600 text-white focus:ring-blue-300"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200 focus:ring-slate-300"
            }`}
          >
            Analytics Dashboard
          </button>
          <button
            onClick={handleLogout}
            className="ml-auto rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1"
          >
            Logout
          </button>
        </nav>

        {activeView === "data-entry" ? (
          <>
            <FactoryChatbot userToken={userToken} />
            <DynamicPlantForm plantId={selectedPlant} userToken={userToken} />
          </>
        ) : (
          <UnidilDashboard userToken={userToken} />
        )}
      </div>
    </div>
  );
}
export default App;
