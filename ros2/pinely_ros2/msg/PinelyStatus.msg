# PINELY machine status telemetry.
# Fields the node cannot know are reported as unknown, never as an invented value.
string machine_id
# "unknown" until an on-chain reading is available
string tier
bool frozen
# false while tier, frozen and stable_balance have not been read from the chain
bool on_chain_state_known
# NaN when unknown
float64 stable_balance
float64 daily_spent
# local safety limit configured by the operator (0 = not configured, payments are blocked)
float64 daily_cap
string last_error
int64 last_updated
