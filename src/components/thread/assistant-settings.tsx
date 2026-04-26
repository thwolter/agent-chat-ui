import { FormEvent, useEffect, useMemo, useState } from "react";
import { Assistant, Client, GraphSchema } from "@langchain/langgraph-sdk";
import {
  Check,
  LoaderCircle,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useAgentContext } from "@/providers/Stream";
import { createClient } from "@/providers/client";
import {
  getAgentAssistantId,
  getAgentRouteId,
  SessionAgent,
} from "@/lib/auth";
import { createAssistantAgent } from "@/lib/created-assistants";

type JsonSchema = {
  type?: string | string[];
  title?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
};

type Field = {
  key: string;
  label: string;
  description?: string;
  schema: JsonSchema;
  required: boolean;
};

type DialogMode = "create" | "edit";

function toLabel(key: string, schema: JsonSchema): string {
  if (schema.title) return schema.title;
  return key
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getSchemaType(schema: JsonSchema): string {
  if (Array.isArray(schema.type)) {
    return schema.type.find((type) => type !== "null") ?? schema.type[0];
  }
  if (schema.type) return schema.type;
  if (schema.enum) return "string";
  if (schema.properties) return "object";
  if (schema.items) return "array";
  return "string";
}

function stringifyFieldValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value, null, 2);
}

function parseFieldValue(schema: JsonSchema, rawValue: string): unknown {
  const type = getSchemaType(schema);
  const trimmed = rawValue.trim();
  if (!trimmed) return undefined;

  if (schema.enum) return rawValue;
  if (type === "number") return Number(rawValue);
  if (type === "integer") return Number.parseInt(rawValue, 10);
  if (type === "boolean") return rawValue === "true";
  if (type === "array" || type === "object") return JSON.parse(rawValue);
  return rawValue;
}

function extractConfigFields(schema?: GraphSchema | null): Field[] {
  const configSchema = schema?.config_schema as JsonSchema | null | undefined;
  const configurable =
    configSchema?.properties?.configurable &&
    getSchemaType(configSchema.properties.configurable) === "object"
      ? configSchema.properties.configurable
      : configSchema;
  const properties = configurable?.properties ?? {};
  const required = new Set(configurable?.required ?? []);

  return Object.entries(properties)
    .filter(([key]) => key !== "thread_id" && key !== "checkpoint_id")
    .map(([key, fieldSchema]) => ({
      key,
      label: toLabel(key, fieldSchema),
      description: fieldSchema.description,
      schema: fieldSchema,
      required: required.has(key),
    }));
}

function getInitialValues(
  fields: Field[],
  assistant?: Assistant | null,
): Record<string, string> {
  const configurable = assistant?.config?.configurable ?? {};
  return Object.fromEntries(
    fields.map((field) => [
      field.key,
      stringifyFieldValue(configurable[field.key] ?? field.schema.default),
    ]),
  );
}

function getTagsValue(assistant?: Assistant | null): string {
  return assistant?.config?.tags?.join(", ") ?? "";
}

async function resolveAgentAssistant(
  client: Client,
  agent: SessionAgent,
): Promise<Assistant> {
  if (agent.assistant_id) {
    try {
      return await client.assistants.get(agent.assistant_id);
    } catch {
      // Some agents expose only a graph identifier. Search so schema requests
      // can use an actual LangGraph assistant_id.
    }
  }

  const assistants = await client.assistants.search({ limit: 100 });
  const configuredAssistantId = getAgentAssistantId(agent);
  const graphCandidates = new Set(
    [agent.graph_id, agent.key, agent.name].filter(Boolean),
  );
  const match =
    assistants.find(
      (assistant) => assistant.assistant_id === configuredAssistantId,
    ) ??
    assistants.find((assistant) => graphCandidates.has(assistant.graph_id)) ??
    assistants.find((assistant) => assistant.name === agent.name) ??
    (assistants.length === 1 ? assistants[0] : undefined);

  if (!match) {
    throw new Error(
      `No LangGraph assistant was found for ${agent.name}. Please check this agent's assistant configuration.`,
    );
  }

  return match;
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: Field;
  value: string;
  onChange: (value: string) => void;
}) {
  const type = getSchemaType(field.schema);
  const id = `assistant-field-${field.key}`;

  if (field.schema.enum) {
    return (
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={field.required}
        className="border-input bg-background h-10 rounded-md border px-3 text-sm shadow-sm outline-none focus:ring-2 focus:ring-gray-300"
      >
        {!field.required && <option value="">Unset</option>}
        {field.schema.enum.map((option) => (
          <option
            key={String(option)}
            value={String(option)}
          >
            {String(option)}
          </option>
        ))}
      </select>
    );
  }

  if (type === "boolean") {
    return (
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={field.required}
        className="border-input bg-background h-10 rounded-md border px-3 text-sm shadow-sm outline-none focus:ring-2 focus:ring-gray-300"
      >
        {!field.required && <option value="">Unset</option>}
        <option value="true">True</option>
        <option value="false">False</option>
      </select>
    );
  }

  if (type === "object" || type === "array") {
    return (
      <Textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={field.required}
        rows={5}
        className="font-mono text-xs"
      />
    );
  }

  return (
    <Input
      id={id}
      type={type === "number" || type === "integer" ? "number" : "text"}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      required={field.required}
    />
  );
}

export function AssistantSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const apiProxyUrl = process.env.NEXT_PUBLIC_API_PROXY_URL || "/api";
  const {
    baseAgents,
    createdAssistants,
    addCreatedAssistant,
    updateCreatedAssistant,
    removeCreatedAssistant,
  } = useAgentContext();
  const [selectedBaseAgentId, setSelectedBaseAgentId] = useState("");
  const [mode, setMode] = useState<DialogMode>("create");
  const [editingAssistant, setEditingAssistant] = useState<Assistant | null>(
    null,
  );
  const [schema, setSchema] = useState<GraphSchema | null>(null);
  const [resolvedAssistant, setResolvedAssistant] = useState<Assistant | null>(
    null,
  );
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingAssistantId, setDeletingAssistantId] = useState<string | null>(
    null,
  );
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [recursionLimit, setRecursionLimit] = useState("25");
  const [tags, setTags] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});

  const selectedBaseAgent =
    baseAgents.find((agent) => agent.id === selectedBaseAgentId) ??
    baseAgents[0];
  const fields = useMemo(() => extractConfigFields(schema), [schema]);
  const selectedCreatedAssistants = useMemo(
    () =>
      createdAssistants.filter(
        (assistant) =>
          selectedBaseAgent &&
          getAgentRouteId(assistant) === getAgentRouteId(selectedBaseAgent),
      ),
    [createdAssistants, selectedBaseAgent],
  );

  const resetCreateForm = (agent = selectedBaseAgent) => {
    setMode("create");
    setEditingAssistant(null);
    setName(agent ? `${agent.name} v1` : "");
    setDescription("");
    setRecursionLimit("25");
    setTags("");
    setValues(getInitialValues(fields));
  };

  useEffect(() => {
    if (!open) return;
    setSelectedBaseAgentId((current) => current || baseAgents[0]?.id || "");
  }, [baseAgents, open]);

  useEffect(() => {
    if (!open || !selectedBaseAgent) return;

    let cancelled = false;
    const loadSchema = async (agent: SessionAgent) => {
      setSchemaLoading(true);
      setSchema(null);
      setResolvedAssistant(null);
      setEditingAssistant(null);
      try {
        const client = createClient(apiProxyUrl, undefined, undefined, {
          "x-agent-id": getAgentRouteId(agent),
        });
        const assistant = await resolveAgentAssistant(client, agent);
        const nextSchema = await client.assistants.getSchemas(
          assistant.assistant_id,
        );
        if (cancelled) return;
        const nextFields = extractConfigFields(nextSchema);
        setResolvedAssistant(assistant);
        setSchema(nextSchema);
        setMode("create");
        setName(`${agent.name} v1`);
        setDescription("");
        setRecursionLimit("25");
        setTags("");
        setValues(getInitialValues(nextFields));
      } catch (error) {
        if (cancelled) return;
        setValues({});
        toast.error("Failed to load assistant schema", {
          description:
            error instanceof Error ? error.message : "Schema request failed.",
        });
      } finally {
        if (!cancelled) setSchemaLoading(false);
      }
    };

    loadSchema(selectedBaseAgent).catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [apiProxyUrl, open, selectedBaseAgent]);

  useEffect(() => {
    if (!open || mode !== "create") return;
    setValues(getInitialValues(fields));
  }, [fields, mode, open]);

  if (!open) return null;

  const getClientForSelectedAgent = () => {
    if (!selectedBaseAgent) throw new Error("No agent selected.");
    return createClient(apiProxyUrl, undefined, undefined, {
      "x-agent-id": getAgentRouteId(selectedBaseAgent),
    });
  };

  const handleEditAssistant = async (assistantAgent: SessionAgent) => {
    if (!selectedBaseAgent || assistantLoading) return;
    setAssistantLoading(true);
    try {
      const client = getClientForSelectedAgent();
      const assistant = await client.assistants.get(
        getAgentAssistantId(assistantAgent),
      );
      setMode("edit");
      setEditingAssistant(assistant);
      setName(assistant.name || assistantAgent.name);
      setDescription(assistant.description ?? assistantAgent.description ?? "");
      setRecursionLimit(String(assistant.config?.recursion_limit ?? 25));
      setTags(getTagsValue(assistant));
      setValues(getInitialValues(fields, assistant));
    } catch (error) {
      toast.error("Failed to load assistant", {
        description:
          error instanceof Error ? error.message : "Assistant request failed.",
      });
    } finally {
      setAssistantLoading(false);
    }
  };

  const handleDeleteAssistant = async (assistantAgent: SessionAgent) => {
    if (!selectedBaseAgent || deletingAssistantId) return;
    const shouldDelete = window.confirm(
      `Delete assistant "${assistantAgent.name}"? This cannot be undone.`,
    );
    if (!shouldDelete) return;

    setDeletingAssistantId(assistantAgent.id);
    try {
      const client = getClientForSelectedAgent();
      await client.assistants.delete(getAgentAssistantId(assistantAgent));
      removeCreatedAssistant(assistantAgent.id);
      if (editingAssistant?.assistant_id === assistantAgent.assistant_id) {
        resetCreateForm();
      }
      toast.success("Assistant deleted");
    } catch (error) {
      toast.error("Failed to delete assistant", {
        description:
          error instanceof Error ? error.message : "Assistant request failed.",
      });
    } finally {
      setDeletingAssistantId(null);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedBaseAgent || saving) return;

    const configurable: Record<string, unknown> = {};
    try {
      for (const field of fields) {
        const parsedValue = parseFieldValue(field.schema, values[field.key]);
        if (parsedValue !== undefined) configurable[field.key] = parsedValue;
      }
    } catch (error) {
      toast.error("Invalid configuration value", {
        description:
          error instanceof Error
            ? error.message
            : "Check JSON values and try again.",
      });
      return;
    }

    setSaving(true);
    try {
      const client = getClientForSelectedAgent();
      const config = {
        configurable,
        recursion_limit: recursionLimit
          ? Number.parseInt(recursionLimit, 10)
          : undefined,
        tags: tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      };
      const metadata = {
        created_from_chat_ui: true,
        base_agent_id: selectedBaseAgent.id,
        base_agent_name: selectedBaseAgent.name,
      };

      if (mode === "edit" && editingAssistant) {
        const assistant = await client.assistants.update(
          editingAssistant.assistant_id,
          {
            graphId: schema?.graph_id || editingAssistant.graph_id,
            name: name.trim(),
            description: description.trim() || undefined,
            config,
            metadata,
          },
        );
        updateCreatedAssistant(createAssistantAgent(selectedBaseAgent, assistant));
        setEditingAssistant(assistant);
        toast.success("Assistant updated");
        return;
      }

      const assistant = await client.assistants.create({
        graphId:
          schema?.graph_id ||
          resolvedAssistant?.graph_id ||
          selectedBaseAgent.graph_id ||
          selectedBaseAgent.key ||
          selectedBaseAgent.name,
        name: name.trim(),
        description: description.trim() || undefined,
        config,
        metadata,
      });

      addCreatedAssistant(createAssistantAgent(selectedBaseAgent, assistant));
      setEditingAssistant(assistant);
      setMode("edit");
      toast.success("Assistant created");
    } catch (error) {
      toast.error(
        mode === "edit" ? "Failed to update assistant" : "Failed to create assistant",
        {
          description:
            error instanceof Error ? error.message : "Assistant request failed.",
        },
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4"
    >
      <form
        onSubmit={handleSubmit}
        className="bg-background grid h-[min(760px,90vh)] w-full max-w-5xl grid-cols-1 overflow-hidden rounded-xl border shadow-2xl md:grid-cols-[300px_1fr]"
      >
        <aside className="flex min-h-0 flex-col border-r bg-slate-50">
          <div className="flex items-center justify-between border-b px-4 py-4">
            <h2 className="text-sm font-semibold tracking-wide text-slate-700 uppercase">
              Assistant Management
            </h2>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={() => resetCreateForm()}
            >
              <Plus className="size-4" />
              New
            </Button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
            <div className="grid gap-2">
              <Label htmlFor="assistant-agent">Agent</Label>
              <select
                id="assistant-agent"
                value={selectedBaseAgent?.id ?? ""}
                onChange={(event) => setSelectedBaseAgentId(event.target.value)}
                className="border-input bg-background h-10 rounded-md border px-3 text-sm shadow-sm outline-none focus:ring-2 focus:ring-gray-300"
              >
                {baseAgents.map((agent) => (
                  <option
                    key={agent.id}
                    value={agent.id}
                  >
                    {agent.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-2">
              <h3 className="text-xs font-semibold tracking-wide text-slate-600 uppercase">
                Created Assistants
              </h3>
              <div className="min-h-0 divide-y overflow-y-auto pr-1">
                {selectedCreatedAssistants.length === 0 ? (
                  <p className="text-muted-foreground py-3 text-sm">
                    No assistants created for this agent yet.
                  </p>
                ) : (
                  selectedCreatedAssistants.map((assistant) => {
                    const isSelected =
                      editingAssistant?.assistant_id === assistant.assistant_id;
                    return (
                      <div
                        key={assistant.id}
                        className={cn(
                          "py-2.5 transition-colors hover:bg-slate-100",
                          isSelected && "bg-slate-100",
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {assistant.name}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-7"
                              aria-label={`Edit ${assistant.name}`}
                              disabled={assistantLoading}
                              onClick={() => handleEditAssistant(assistant)}
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-7 text-rose-600 hover:text-rose-700"
                              aria-label={`Delete ${assistant.name}`}
                              disabled={deletingAssistantId === assistant.id}
                              onClick={() => handleDeleteAssistant(assistant)}
                            >
                              {deletingAssistantId === assistant.id ? (
                                <LoaderCircle className="size-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="size-3.5" />
                              )}
                            </Button>
                          </div>
                        </div>
                        <div className="min-w-0">
                          {assistant.description && (
                            <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">
                              {assistant.description}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </aside>

        <section className="flex min-h-0 flex-col">
          <header className="flex items-center justify-between border-b px-5 py-4">
            <div>
              <h3 className="text-xl font-semibold tracking-tight">
                {mode === "edit" ? "Edit Assistant" : "Create Assistant"}
              </h3>
              <p className="text-muted-foreground text-sm">
                {selectedBaseAgent?.name}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-md p-2 text-slate-600 hover:bg-slate-100"
              aria-label="Close"
            >
              <X className="size-5" />
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            <div className="grid gap-5">
              <div className="grid gap-2">
                <Label htmlFor="assistant-name">
                  Assistant Name<span className="text-rose-500">*</span>
                </Label>
                <Input
                  id="assistant-name"
                  name="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="assistant-description">Description</Label>
                <Textarea
                  id="assistant-description"
                  name="description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={3}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="assistant-recursion-limit">
                  Recursion Limit
                </Label>
                <p className="text-muted-foreground text-sm">
                  The maximum number of times the assistant can call itself
                  recursively.
                </p>
                <Input
                  id="assistant-recursion-limit"
                  name="recursion_limit"
                  type="number"
                  min={1}
                  value={recursionLimit}
                  onChange={(event) => setRecursionLimit(event.target.value)}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="assistant-tags">Tags</Label>
                <p className="text-muted-foreground text-sm">
                  Comma-separated tags for filtering and organization.
                </p>
                <Input
                  id="assistant-tags"
                  name="tags"
                  value={tags}
                  onChange={(event) => setTags(event.target.value)}
                  placeholder="production, evaluation"
                />
              </div>

              <div className="border-t pt-5">
                <div className="mb-4 flex items-center gap-2">
                  <h4 className="font-semibold">Configuration</h4>
                  {(schemaLoading || assistantLoading) && (
                    <LoaderCircle className="size-4 animate-spin text-slate-500" />
                  )}
                </div>

                <div
                  className={cn(
                    "grid gap-5",
                    (schemaLoading || assistantLoading) &&
                      "pointer-events-none opacity-60",
                  )}
                >
                  {!schemaLoading && fields.length === 0 && (
                    <p className="text-muted-foreground rounded-md border border-dashed p-4 text-sm">
                      This agent does not expose configurable assistant fields.
                    </p>
                  )}
                  {fields.map((field) => (
                    <div
                      key={field.key}
                      className="grid gap-2"
                    >
                      <Label htmlFor={`assistant-field-${field.key}`}>
                        {field.label}
                        {field.required && (
                          <span className="text-rose-500">*</span>
                        )}
                      </Label>
                      {field.description && (
                        <p className="text-muted-foreground text-sm">
                          {field.description}
                        </p>
                      )}
                      <FieldInput
                        field={field}
                        value={values[field.key] ?? ""}
                        onChange={(value) =>
                          setValues((current) => ({
                            ...current,
                            [field.key]: value,
                          }))
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <footer className="flex justify-end gap-3 border-t px-5 py-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                saving ||
                schemaLoading ||
                assistantLoading ||
                !selectedBaseAgent ||
                !name.trim()
              }
            >
              {saving ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Check className="size-4" />
              )}
              {mode === "edit" ? "Save Changes" : "Create Assistant"}
            </Button>
          </footer>
        </section>
      </form>
    </div>
  );
}
