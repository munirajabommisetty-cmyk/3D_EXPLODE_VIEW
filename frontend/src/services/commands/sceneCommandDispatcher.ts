/**
 * Scene Command Dispatcher (Task V1)
 *
 * The single entry point through which every input method operates the workspace:
 *   input (gesture / voice / keyboard / UI / AI)
 *     -> validateSceneCommand(command, live context)   // reject unknown parts, unsupported actions
 *     -> handler that owns that command type           // viewer (camera, animation) or workspace (state)
 *     -> result: executed | deferred | rejected        // recorded + broadcast to listeners
 *
 * Handlers and context providers are registered by the components that own the relevant state,
 * so no React state is duplicated here.
 */

import {
  EMPTY_COMMAND_CONTEXT,
  validateSceneCommand,
  type CommandSource,
  type RejectionCode,
  type SceneCommand,
  type SceneCommandContext,
  type SceneCommandType,
} from './sceneCommands';

export type CommandStatus = 'executed' | 'deferred' | 'rejected' | 'expired';

export interface HandlerOutcome {
  status: 'executed' | 'deferred' | 'rejected';
  detail?: string;
  code?: RejectionCode;
}

export interface CommandHandler {
  id: string;
  canHandle: (type: SceneCommandType) => boolean;
  execute: (command: SceneCommand, source: CommandSource) => HandlerOutcome;
}

export type ContextProvider = () => Partial<SceneCommandContext>;

export interface CommandRecord {
  id: number;
  timestamp: number;
  source: CommandSource;
  command: SceneCommand | unknown;
  status: CommandStatus;
  code?: RejectionCode;
  detail?: string;
}

export type CommandListener = (record: CommandRecord) => void;

const HISTORY_LIMIT = 50;

export class SceneCommandDispatcher {
  private readonly handlers = new Map<string, CommandHandler>();
  private readonly providers = new Map<string, ContextProvider>();
  private readonly listeners = new Set<CommandListener>();
  private readonly history: CommandRecord[] = [];
  private nextId = 1;
  private readonly now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  /** Registers (or replaces) a handler. Returns an unregister function. */
  public registerHandler(handler: CommandHandler): () => void {
    this.handlers.set(handler.id, handler);
    return () => {
      if (this.handlers.get(handler.id) === handler) this.handlers.delete(handler.id);
    };
  }

  /** Registers (or replaces) a live context provider. Later providers override earlier keys. */
  public registerContextProvider(id: string, provider: ContextProvider): () => void {
    this.providers.set(id, provider);
    return () => {
      if (this.providers.get(id) === provider) this.providers.delete(id);
    };
  }

  /** Current merged context, used for validation (and later sent to the AI teacher). */
  public getContext(): SceneCommandContext {
    let ctx: SceneCommandContext = { ...EMPTY_COMMAND_CONTEXT };
    for (const provider of this.providers.values()) {
      ctx = { ...ctx, ...provider() };
    }
    return ctx;
  }

  /** Validates and executes a command from any input source. Never throws. */
  public dispatch(input: unknown, source: CommandSource): CommandRecord {
    const validation = validateSceneCommand(input, this.getContext());
    if (!validation.ok) {
      return this.record({ source, command: input, status: 'rejected', code: validation.code, detail: validation.reason });
    }
    const command = validation.command;
    const handler = [...this.handlers.values()].find((h) => h.canHandle(command.type));
    if (!handler) {
      return this.record({ source, command, status: 'rejected', code: 'NO_HANDLER', detail: `No handler for "${command.type}".` });
    }
    try {
      const outcome = handler.execute(command, source);
      return this.record({ source, command, status: outcome.status, code: outcome.code, detail: outcome.detail });
    } catch (err) {
      return this.record({
        source, command, status: 'rejected', code: 'NO_HANDLER',
        detail: `Handler failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  /** Lets a handler report the later fate of a deferred command (executed or expired). */
  public reportDeferredOutcome(command: SceneCommand, source: CommandSource, status: 'executed' | 'expired', detail?: string): CommandRecord {
    return this.record({ source, command, status, detail });
  }

  public subscribe(listener: CommandListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public getHistory(): readonly CommandRecord[] {
    return this.history;
  }

  private record(entry: Omit<CommandRecord, 'id' | 'timestamp'>): CommandRecord {
    const rec: CommandRecord = { id: this.nextId++, timestamp: this.now(), ...entry };
    this.history.push(rec);
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
    for (const listener of this.listeners) {
      try {
        listener(rec);
      } catch {
        // a faulty listener must never break command execution
      }
    }
    return rec;
  }
}
