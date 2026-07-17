// Benchy runs one set of tools for every model, so the comparison measures how
// well each model USES the same tools — not whose provider ships a better
// hosted web search. The tool defines a provider-neutral JSON-schema spec; each
// adapter translates that into its own tool-calling format.

export interface ToolSpec {
  name: string
  description: string
  // JSON Schema for an object of arguments. Kept loose on purpose — every
  // provider forwards it near-verbatim, and each has its own strictness.
  parameters: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

export interface Tool {
  spec: ToolSpec
  // Returns the text handed back to the model as the tool result. Throwing is
  // fine: the loop turns it into an error result the model can react to, rather
  // than failing the whole cell.
  run(args: Record<string, unknown>): Promise<string>
}
