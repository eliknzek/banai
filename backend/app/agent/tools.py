"""Function tools offered to the model (OpenAI Responses API format).

Op objects are left open here on purpose: their real schema is enforced by Pydantic
(`app.domain.ops.parse_ops`) after the call, and a rejection is fed back for repair.
"""

PROPOSE_CHANGES = "propose_changes"
RESPOND = "respond"

TOOLS = [
    {
        "type": "function",
        "name": PROPOSE_CHANGES,
        "description": "Propose a batch of design ops. The customer must confirm it before anything changes.",
        "strict": False,
        "parameters": {
            "type": "object",
            "properties": {
                "message": {"type": "string", "description": "Short message to the customer about the proposal."},
                "summary": {"type": "string", "description": "One-line summary of the proposal (max 120 chars)."},
                "ops": {"type": "array", "items": {"type": "object"}, "minItems": 1, "maxItems": 100},
            },
            "required": ["message", "summary", "ops"],
            "additionalProperties": False,
        },
    },
    {
        "type": "function",
        "name": RESPOND,
        "description": "Reply to the customer without proposing changes (for example a clarifying question).",
        "strict": False,
        "parameters": {
            "type": "object",
            "properties": {"message": {"type": "string"}},
            "required": ["message"],
            "additionalProperties": False,
        },
    },
]
