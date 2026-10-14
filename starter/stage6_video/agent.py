"""Step 8 - the video. The step 7 graph plus the render desk.

A Veo render takes minutes. render_submit (agent/desk.py) submits it and
returns a pending receipt; wrapped in LongRunningFunctionTool, that receipt
suspends the workflow at render_desk with the call's id in the session.
`python -m agent.deliver` later answers that id and the graph continues.
"""
from google.adk import Agent, Workflow
from google.adk.tools import LongRunningFunctionTool
from google.adk.workflow import START, JoinNode

from agent.platform import config
from agent.cleanup_tools import find_policy_hits, suggest_replacement
from agent.desk import RENDER_INSTRUCTION, render_submit
from agent.graph import (PROPOSE_INSTRUCTION, QUARANTINE_INSTRUCTION,
                         SCRIPT_INSTRUCTION, direction_gate, persist_direction,
                         policy_check, read_backlog, read_feedback, scan_trends,
                         store_video)
from agent.platform.memory import recall_taste, remember_pick
from agent.schemas import CleanedDirection, Directions, Script

join_research = JoinNode(name="join_research")

propose_directions = Agent(
    name="propose_directions",
    model=config.MODEL,
    instruction=PROPOSE_INSTRUCTION,
    output_schema=Directions,
    before_model_callback=recall_taste)

scripter = Agent(
    name="scripter",
    model=config.MODEL,
    instruction=SCRIPT_INSTRUCTION,
    output_schema=Script,
    after_agent_callback=remember_pick)

quarantine = Agent(
    name="quarantine",
    model=config.MODEL,
    mode="task",
    instruction=QUARANTINE_INSTRUCTION,
    tools=[find_policy_hits, suggest_replacement],
    output_schema=CleanedDirection)

render_desk = Agent(
    name="render_desk",
    model=config.MODEL,
    instruction=RENDER_INSTRUCTION,
    tools=[render_submit])  # TODO: VIDEO_TOOL - wrap it: LongRunningFunctionTool(render_submit)

root_agent = Workflow(
    name="stage6_video",
    description="research -> you -> the policy gate -> a script -> one Veo clip, delivered later by id",
    edges=[(START, scan_trends, join_research),
           (START, read_backlog, join_research),
           (START, read_feedback, join_research),
           (join_research, propose_directions, direction_gate,
            persist_direction, policy_check),
           (policy_check, {"OK": scripter, "BLOCK": quarantine}),
           (quarantine, scripter)])  # TODO: VIDEO_EDGES - add the last chain: (scripter, render_desk, store_video)
