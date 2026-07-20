# protocol

The central protocol layer. Passive, not a process.

Covers every protocol and the orchestration built on them, and is the main wrapper layer: all calls go through it. It defines and carries the conversation between machines — it does not run as a separate active process, and nothing here requires a daemon of its own. Servers and clients both speak it; the server package hosts it, the clients consume it.
