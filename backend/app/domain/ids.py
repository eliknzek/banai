"""Stable, typed component identifiers (`<prefix>_<suffix>`). Mirrors frontend/src/domain/ids.js.

Ids are random by default. Inside `seeded_ids(seed)` they are derived from the seed and a
counter instead, so replaying the same ops with the same seed yields the same ids. AI
proposals use their proposal id as the seed: the dry-run and the approved apply match.
"""

import hashlib
import hmac
import secrets
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar

_seed_state: ContextVar[list | None] = ContextVar("_seed_state", default=None)

COMPARTMENT = "cmp"
PARTITION = "prt"
SHELF = "shf"
DRAWER = "drw"
RAIL = "rail"
DOOR = "dr"

_SUFFIX = r"[A-Za-z0-9_-]{1,40}"
ANY_ID_PATTERN = rf"^(cmp|prt|shf|drw|rail|dr)_{_SUFFIX}$"


def id_pattern(prefix: str) -> str:
    return rf"^{prefix}_{_SUFFIX}$"


def new_id(prefix: str) -> str:
    state = _seed_state.get()
    if state is None:
        return f"{prefix}_{secrets.token_hex(4)}"
    seed, counter = state
    state[1] = counter + 1
    digest = hmac.new(seed, f"{prefix}:{counter}".encode(), hashlib.sha256).hexdigest()
    return f"{prefix}_{digest[:8]}"


@contextmanager
def seeded_ids(seed: str) -> Iterator[None]:
    token = _seed_state.set([seed.encode(), 0])
    try:
        yield
    finally:
        _seed_state.reset(token)
