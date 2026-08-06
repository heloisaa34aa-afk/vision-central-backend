import { supabase } from '../feedWorker/supabaseClient';
import { sendPush } from './push';

const CHECK_INTERVAL_MS = 60_000;
const OFFLINE_AFTER_SECONDS = Number(process.env.TV_OFFLINE_AFTER_SECONDS) || 120;
let started = false;
let checking = false;

function isOffline(tv: any) {
  if (tv.status !== 'Online' || !tv.ultima_conexao) return true;
  const lastSeen = new Date(tv.ultima_conexao).getTime();
  return !Number.isFinite(lastSeen) || Date.now() - lastSeen > OFFLINE_AFTER_SECONDS * 1000;
}

async function recordAndNotify(tv: any, clientName: string, offline: boolean) {
  const type = offline ? 'offline' : 'recovered';
  const title = offline ? `TV offline: ${tv.nome}` : `TV recuperada: ${tv.nome}`;
  const body = offline
    ? `${clientName} — a TV parou de enviar sinal.`
    : `${clientName} — a TV voltou a ficar online.`;

  const { error } = await supabase.from('alert_events').insert({
    tv_id: String(tv.id),
    cliente_id: tv.cliente_id ? String(tv.cliente_id) : null,
    tipo: type,
    titulo: title,
    mensagem: body,
  });
  if (error) console.error('[Alerts] Falha ao registrar evento:', error.message);

  await sendPush({ title, body, type, tag: `tv-${tv.id}`, url: '/?tab=alerts' });
}

export async function checkTvAlerts() {
  if (checking) return;
  checking = true;
  try {
    const [{ data: tvs, error: tvError }, { data: clients, error: clientError }, { data: states, error: stateError }] = await Promise.all([
      supabase.from('tvs').select('id,nome,cliente_id,status,ultima_conexao'),
      supabase.from('clientes').select('id,nome'),
      supabase.from('tv_alert_state').select('tv_id,is_offline'),
    ]);
    if (tvError) throw tvError;
    if (clientError) throw clientError;
    if (stateError) throw stateError;

    const clientNames = new Map((clients || []).map((client: any) => [String(client.id), client.nome]));
    const previous = new Map((states || []).map((state: any) => [String(state.tv_id), Boolean(state.is_offline)]));

    for (const tv of tvs || []) {
      const offline = isOffline(tv);
      const oldState = previous.get(String(tv.id));
      const changed = oldState === undefined ? offline : oldState !== offline;

      const { error } = await supabase.from('tv_alert_state').upsert({
        tv_id: String(tv.id),
        is_offline: offline,
        last_change: changed ? new Date().toISOString() : undefined,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'tv_id' });
      if (error) throw error;

      if (changed) {
        const clientName = clientNames.get(String(tv.cliente_id)) || 'Cliente não identificado';
        await recordAndNotify(tv, clientName, offline);
      }
    }
  } catch (error: any) {
    console.error('[Alerts] Erro no monitoramento:', error?.message || error);
  } finally {
    checking = false;
  }
}

export function initAlertMonitor() {
  if (started) return;
  started = true;
  console.log(`[Alerts] Monitor iniciado; offline após ${OFFLINE_AFTER_SECONDS}s.`);
  void checkTvAlerts();
  setInterval(() => void checkTvAlerts(), CHECK_INTERVAL_MS);
}
