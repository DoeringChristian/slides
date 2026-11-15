import React, { useEffect, useRef, useState } from 'react';
import { Settings, X, Square, Undo2, Trash2, ArrowUp, Check, AlertCircle, Loader2, LogOut, Paperclip, FileText, MessageSquare } from 'lucide-react';
import { isSupportedAttachment, prepareAttachment, type ChatAttachment } from '../../agent/attachments';
import { useAgentStore, type ChatItem } from '../../agent/agentStore';
import { useAgentSettings, PROVIDER_LABELS, relayServerUrl, hasCredentials, type ProviderId } from '../../agent/agentSettings';
import { chatgptRelay, type ChatGPTStatus } from '../../agent/providers/openai';
import { usePresentationStore } from '../../store/presentationStore';

const inputClass = 'mt-1 w-full border border-gray-300 rounded px-2 py-1 font-mono text-xs';
const labelClass = 'text-xs font-medium text-gray-600';

type RelayState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'ok'; status: ChatGPTStatus }
  | { kind: 'error'; message: string };

/** Ask the slides server for the ChatGPT sign-in state. */
async function fetchRelayState(url: string): Promise<RelayState> {
  try {
    return { kind: 'ok', status: await chatgptRelay.status(url) };
  } catch (err) {
    return {
      kind: 'error',
      message: err instanceof TypeError
        ? `No slides server at ${url}. ChatGPT sign-in needs the server running on this computer.`
        : (err as Error).message,
    };
  }
}

/** Live ChatGPT sign-in state from the local slides server, re-polled while
 *  a sign-in is in progress in another tab. */
function useChatGPT(enabled: boolean) {
  const relayUrl = useAgentSettings(s => s.relayUrl);
  const [state, setState] = useState<RelayState>({ kind: 'idle' });
  const [signingIn, setSigningIn] = useState(false);
  const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);
  // Bumped to re-check after sign-out or a failed action.
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const url = relayServerUrl({ relayUrl });
    const check = () => fetchRelayState(url).then(next => {
      if (!live) return;
      setState(next);
      if (next.kind !== 'ok' || !next.status.signedIn) return;
      setSigningIn(false);
      if (next.status.planUsage) chatgptRelay.models(url).then(list => { if (live) setModels(list); }).catch(() => {});
    });
    void check();
    // While a sign-in runs in another tab, poll until it lands.
    const timer = signingIn ? setInterval(() => { void check(); }, 2000) : undefined;
    return () => { live = false; if (timer) clearInterval(timer); };
  }, [enabled, relayUrl, signingIn, epoch]);

  const signIn = async () => {
    try {
      const { url } = await chatgptRelay.login(relayServerUrl({ relayUrl }));
      window.open(url, '_blank', 'noopener');
      setSigningIn(true);
    } catch (err) {
      setState({ kind: 'error', message: (err as Error).message });
    }
  };
  const signOut = async () => {
    await chatgptRelay.logout(relayServerUrl({ relayUrl })).catch(() => {});
    setModels([]);
    setEpoch(e => e + 1);
  };
  return { state, signingIn, models, signIn, signOut };
}

const KeyField: React.FC<{ provider: 'anthropic' | 'openai' }> = ({ provider }) => {
  const field = provider === 'anthropic' ? 'anthropicKey' : 'openaiKey';
  const saved = useAgentSettings(s => s[field]);
  const update = useAgentSettings(s => s.update);
  const [draft, setDraft] = useState(saved);
  return (
    <>
      <label className="block">
        <span className={labelClass}>{provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} API key</span>
        <input
          type="password"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => update({ [field]: draft.trim() })}
          placeholder={provider === 'anthropic' ? 'sk-ant-…' : 'sk-…'}
          autoComplete="off"
          spellCheck={false}
          className={inputClass}
        />
      </label>
      <p className="text-xs text-gray-500 leading-snug">
        Stored in this browser only and sent only to the {provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} API —
        never to the slides server, into the deck, or into exports. Usage is billed to this key.
      </p>
    </>
  );
};

const ChatGPTSection: React.FC<{ chatgpt: ReturnType<typeof useChatGPT> }> = ({ chatgpt }) => {
  const { state, signingIn, signIn, signOut } = chatgpt;
  const relayUrl = useAgentSettings(s => s.relayUrl);
  const update = useAgentSettings(s => s.update);
  const status = state.kind === 'ok' ? state.status : null;
  return (
    <div className="space-y-2">
      {state.kind === 'checking' || state.kind === 'idle' ? (
        <p className="text-xs text-gray-500 flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Checking the slides server…</p>
      ) : state.kind === 'error' ? (
        <p className="text-xs text-red-600 bg-red-50 rounded px-2 py-1.5">{state.message}</p>
      ) : status?.signedIn ? (
        <div className="flex items-start gap-2 text-xs">
          <span className={`flex-1 ${status.planUsage ? 'text-gray-700' : 'text-amber-700'}`}>
            {status.planUsage
              ? <>Using the ChatGPT plan of <b>{status.email ?? 'your account'}</b>.</>
              : 'Signed in, but plan usage was not allowed. Sign in again and allow it.'}
          </span>
          <button onClick={() => { void signOut(); }} className="flex items-center gap-1 text-gray-500 hover:text-gray-800" title="Sign out">
            <LogOut size={12} /> Sign out
          </button>
        </div>
      ) : null}
      {status && (!status.signedIn || !status.planUsage) && (
        <button
          onClick={() => { void signIn(); }}
          disabled={signingIn}
          className="w-full bg-gray-900 hover:bg-black text-white rounded px-3 py-1.5 text-xs font-medium disabled:opacity-60 flex items-center justify-center gap-1.5"
        >
          {signingIn ? <><Loader2 size={12} className="animate-spin" /> Waiting for sign-in in the other tab…</> : 'Sign in with ChatGPT'}
        </button>
      )}
      <p className="text-xs text-gray-500 leading-snug">
        Requests count against your ChatGPT plan (set a per-app cap in ChatGPT settings).
        The sign-in is held by the slides server on this computer, not by the browser.
      </p>
      <label className="block">
        <span className={labelClass}>Slides server</span>
        <input
          value={relayUrl}
          onChange={e => update({ relayUrl: e.target.value })}
          placeholder={relayServerUrl({ relayUrl: '' })}
          spellCheck={false}
          className={inputClass}
        />
      </label>
    </div>
  );
};

const ModelField: React.FC<{ provider: ProviderId; options: Array<{ id: string; name: string }> }> = ({ provider, options }) => {
  const model = useAgentSettings(s => s.models[provider]);
  const setModel = useAgentSettings(s => s.setModel);
  useEffect(() => {
    // Default to the first model the account offers.
    if (!model && options.length) setModel(provider, options[0].id);
  }, [model, options, provider, setModel]);
  return (
    <label className="block">
      <span className={labelClass}>Model</span>
      {options.length ? (
        <select value={model} onChange={e => setModel(provider, e.target.value)} className={`${inputClass} bg-white`}>
          {!options.some(o => o.id === model) && model && <option value={model}>{model}</option>}
          {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      ) : (
        <input
          value={model}
          onChange={e => setModel(provider, e.target.value)}
          placeholder={provider === 'anthropic' ? 'claude-opus-5-5' : 'model id'}
          spellCheck={false}
          className={inputClass}
        />
      )}
    </label>
  );
};

const SettingsForm: React.FC<{ chatgpt: ReturnType<typeof useChatGPT>; onDone?: () => void }> = ({ chatgpt, onDone }) => {
  const { provider, effort, follow, update } = useAgentSettings();
  return (
    <div className="p-3 space-y-3 text-sm">
      <label className="block">
        <span className={labelClass}>Model provider</span>
        <select
          value={provider}
          onChange={e => update({ provider: e.target.value as ProviderId })}
          className={`${inputClass} font-sans bg-white`}
        >
          {(Object.keys(PROVIDER_LABELS) as ProviderId[]).map(id => <option key={id} value={id}>{PROVIDER_LABELS[id]}</option>)}
        </select>
      </label>
      {provider === 'chatgpt' ? <ChatGPTSection chatgpt={chatgpt} /> : <KeyField key={provider} provider={provider} />}
      <ModelField provider={provider} options={provider === 'chatgpt' ? chatgpt.models : []} />
      <label className="block">
        <span className={labelClass}>Effort</span>
        <select
          value={effort}
          onChange={e => update({ effort: e.target.value as typeof effort })}
          className={`${inputClass} font-sans bg-white`}
        >
          <option value="">Model default</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          {provider === 'anthropic' && <option value="xhigh">Extra high</option>}
          {provider === 'anthropic' && <option value="max">Max</option>}
        </select>
      </label>
      <label className="flex items-center gap-2 text-xs text-gray-700">
        <input type="checkbox" checked={follow} onChange={e => update({ follow: e.target.checked })} />
        Follow the assistant to the slide it edits
      </label>
      {onDone && (
        <button
          onClick={() => { (document.activeElement as HTMLElement | null)?.blur(); onDone(); }}
          className="w-full bg-blue-500 hover:bg-blue-600 text-white rounded px-3 py-1.5 text-xs font-medium"
        >
          Done
        </button>
      )}
    </div>
  );
};

const ToolRow: React.FC<{ item: Extract<ChatItem, { kind: 'tool' }> }> = ({ item }) => (
  <div className={`flex items-start gap-1.5 text-xs ${item.isError ? 'text-amber-700' : 'text-gray-500'}`}>
    <span className="mt-0.5 shrink-0">
      {!item.done ? <Loader2 size={12} className="animate-spin" />
        : item.isError ? <AlertCircle size={12} /> : <Check size={12} />}
    </span>
    <span className="break-words min-w-0">{item.summary ?? item.name.replace(/_/g, ' ')}</span>
  </div>
);

const AttachmentChips: React.FC<{ attachments: NonNullable<Extract<ChatItem, { kind: 'user' }>['attachments']>; onRemove?: (id: string) => void }> = ({ attachments, onRemove }) => (
  <div className="flex flex-wrap gap-1.5">
    {attachments.map(a => (
      <div key={a.id} className="relative flex items-center gap-1 bg-white border border-gray-200 rounded px-1 py-0.5 text-xs text-gray-600 max-w-full" title={a.name}>
        {a.kind === 'image' && a.previewUrl
          ? <img src={a.previewUrl} alt="" className="w-8 h-8 object-cover rounded-sm" />
          : <FileText size={14} className="text-gray-500" />}
        <span className="truncate max-w-[9rem]">{a.name}</span>
        {onRemove && (
          <button onClick={() => onRemove(a.id)} className="text-gray-400 hover:text-gray-700" title="Remove">
            <X size={11} />
          </button>
        )}
      </div>
    ))}
  </div>
);

const ChatRow: React.FC<{ item: ChatItem }> = ({ item }) => {
  switch (item.kind) {
    case 'user':
      return (
        <div className={`ml-6 rounded-lg px-3 py-2 text-sm space-y-1.5 ${item.fromComment ? 'bg-amber-50 border border-amber-200' : 'bg-blue-50'} ${item.queued ? 'opacity-60' : ''}`}>
          {item.fromComment && <div className="flex items-center gap-1 text-[11px] font-medium text-amber-700"><MessageSquare size={11} /> From a comment</div>}
          {item.text && <div className="text-gray-800 whitespace-pre-wrap break-words">{item.fromComment ? item.text.replace(/\n\n\(Comment id [^)]*\)$/, '') : item.text}</div>}
          {!!item.attachments?.length && <AttachmentChips attachments={item.attachments} />}
          {item.queued && <div className="text-[11px] text-gray-500">Queued — runs after the current turn</div>}
          {item.notSent && <div className="text-[11px] text-gray-500">Not sent — the page was reloaded first</div>}
        </div>
      );
    case 'assistant':
      return <div className="text-gray-800 text-sm whitespace-pre-wrap break-words">{item.text}</div>;
    case 'tool':
      return <ToolRow item={item} />;
    case 'error':
      return <div className="text-xs text-red-600 bg-red-50 rounded px-2 py-1.5 break-words">{item.text}</div>;
  }
};

export const AgentPanel: React.FC = () => {
  const thread = useAgentStore(s => s.thread);
  const running = useAgentStore(s => s.running);
  const workingSlideId = useAgentStore(s => s.workingSlideId);
  const { send, stop, undoLastTurn, clear } = useAgentStore.getState();
  const items = thread.items;
  const settings = useAgentSettings();
  const chatgpt = useChatGPT(settings.panelOpen && settings.provider === 'chatgpt');
  const chatgptReady = chatgpt.state.kind === 'ok' && chatgpt.state.status.signedIn && chatgpt.state.status.planUsage;
  const ready = hasCredentials(settings) && !!settings.models[settings.provider]
    && (settings.provider !== 'chatgpt' || chatgptReady);
  const close = () => useAgentSettings.getState().update({ panelOpen: false });
  const slideOrder = usePresentationStore(s => s.presentation.slideOrder);
  // Re-evaluate "Undo turn" whenever the deck changes (an edit or Cmd+Z
  // after the turn makes it no longer the newest undo step).
  usePresentationStore(s => s.presentation);
  const [showSettings, setShowSettings] = useState(false);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<ChatAttachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [items]);

  const addFiles = async (files: Iterable<File>) => {
    setAttachError(null);
    for (const file of files) {
      if (!isSupportedAttachment(file)) {
        setAttachError(`${file.name || 'That file'}: only PNG, JPEG, GIF, WebP and PDF can be attached.`);
        continue;
      }
      try {
        const attachment = await prepareAttachment(file);
        setPending(p => [...p, attachment]);
      } catch (err) {
        setAttachError((err as Error).message);
      }
    }
  };

  const submit = () => {
    const text = draft.trim();
    if (!text && !pending.length) return;
    setDraft('');
    setPending([]);
    setAttachError(null);
    send(text, pending);
  };

  const workingIndex = workingSlideId ? slideOrder.indexOf(workingSlideId) : -1;
  const canUndoTurn = !running && !!thread.lastTurn?.canUndo();

  return (
    <div
      className={`w-80 bg-white border-l border-gray-200 flex flex-col shrink-0 select-text relative ${dragging ? 'ring-2 ring-inset ring-blue-400' : ''}`}
      data-testid="agent-panel"
      onDragOver={e => { if (ready && e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={e => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={e => {
        if (!ready || !e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragging(false);
        void addFiles(e.dataTransfer.files);
      }}
    >
      <div className="flex items-center gap-1 px-3 h-10 border-b border-gray-200 shrink-0">
        <span className="text-sm font-medium text-gray-800 flex-1 truncate">
          Assistant
        </span>
        <button onClick={clear} disabled={running || !items.length} className="p-1 rounded hover:bg-gray-100 text-gray-500 disabled:opacity-40" title="Clear the conversation">
          <Trash2 size={15} />
        </button>
        <button onClick={() => setShowSettings(v => !v)} className={`p-1 rounded hover:bg-gray-100 ${showSettings ? 'text-blue-600' : 'text-gray-500'}`} title="Assistant settings">
          <Settings size={15} />
        </button>
        <button onClick={close} className="p-1 rounded hover:bg-gray-100 text-gray-500" title="Close">
          <X size={15} />
        </button>
      </div>

      {(showSettings || !ready) ? (
        <div className="flex-1 overflow-y-auto">
          {!ready && !showSettings && (
            <p className="px-3 pt-3 text-sm text-gray-700">
              The assistant edits this deck using your own Claude or OpenAI key, or your ChatGPT plan.
            </p>
          )}
          <SettingsForm chatgpt={chatgpt} onDone={showSettings && ready ? () => setShowSettings(false) : undefined} />
        </div>
      ) : (
        <>
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2.5">
            {!items.length && (
              <div className="text-xs text-gray-500 space-y-1.5">
                <p>Ask for changes to this deck. The assistant sees the slide you are on and your selection. Drop images or PDFs here to show it.</p>
                <p className="text-gray-400">“Turn this slide into a two-column comparison”<br />“Animate these bullets in one per slide”<br />“Put this figure on the right half”</p>
              </div>
            )}
            {items.map(item => <ChatRow key={item.id} item={item} />)}
          </div>

          {(running || canUndoTurn) && (
            <div className="flex items-center gap-2 px-3 py-1.5 border-t border-gray-100 text-xs text-gray-600">
              {running ? (
                <>
                  <Loader2 size={12} className="animate-spin" />
                  <span className="flex-1 truncate">{workingIndex >= 0 ? `Working on slide ${workingIndex + 1}` : 'Working…'}</span>
                  <button onClick={stop} className="flex items-center gap-1 px-2 py-0.5 rounded border border-gray-300 hover:bg-gray-50" title="Stop the running turn and drop queued requests">
                    <Square size={10} /> Stop
                  </button>
                </>
              ) : (
                <>
                  <span className="flex-1">Turn finished</span>
                  <button onClick={undoLastTurn} className="flex items-center gap-1 px-2 py-0.5 rounded border border-gray-300 hover:bg-gray-50" title="Revert every change the assistant made in its last turn">
                    <Undo2 size={11} /> Undo turn
                  </button>
                </>
              )}
            </div>
          )}

          <div className="p-2 border-t border-gray-200 shrink-0 space-y-1.5">
            {attachError && <div className="text-xs text-red-600">{attachError}</div>}
            {!!pending.length && (
              <AttachmentChips
                attachments={pending.map(a => ({ id: a.id, name: a.name, kind: a.kind, previewUrl: a.previewUrl }))}
                onRemove={id => setPending(p => p.filter(a => a.id !== id))}
              />
            )}
            <div className="flex items-end gap-1.5 border border-gray-300 rounded-lg px-2 py-1.5 focus-within:border-blue-400">
              <button onClick={() => fileRef.current?.click()} className="p-1 rounded text-gray-500 hover:bg-gray-100" title="Attach images or PDFs">
                <Paperclip size={14} />
              </button>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"
                className="hidden"
                onChange={e => { if (e.target.files) void addFiles(Array.from(e.target.files)); e.target.value = ''; }}
              />
              <textarea
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onPaste={e => {
                  const files = Array.from(e.clipboardData.files);
                  if (files.length) { e.preventDefault(); void addFiles(files); }
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    submit();
                  }
                }}
                rows={Math.min(6, Math.max(1, draft.split('\n').length))}
                placeholder={running ? 'Ask (runs after the current turn)…' : 'Ask the assistant…'}
                className="flex-1 resize-none text-sm outline-none bg-transparent"
              />
              <button
                onClick={submit}
                disabled={!draft.trim() && !pending.length}
                className="p-1 rounded bg-blue-500 text-white disabled:bg-gray-300"
                title="Send (Enter)"
              >
                <ArrowUp size={14} />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
