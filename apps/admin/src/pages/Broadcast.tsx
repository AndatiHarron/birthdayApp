import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { ErrorBox, PageHeader } from '../components/ui';
import { api } from '../lib/api';
import { humanise, number } from '../lib/format';

export function BroadcastPage() {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [deepLink, setDeepLink] = useState('');
  const [audience, setAudience] = useState<'ALL' | 'PREMIUM' | 'VENDORS' | 'BIRTHDAY_SOON'>('ALL');
  const [days, setDays] = useState(7);
  const [sendPush, setSendPush] = useState(true);
  const [result, setResult] = useState<{ queued: number; capped: boolean } | null>(null);

  const send = useMutation({
    mutationFn: () =>
      api.post<{ queued: number; capped: boolean }>('/admin/notifications/broadcast', {
        title,
        body,
        deepLink: deepLink || null,
        sendPush,
        audience:
          audience === 'PREMIUM' ? { isPremium: true } : audience === 'VENDORS' ? { role: 'VENDOR' } : audience === 'BIRTHDAY_SOON' ? { hasBirthdayInDays: days } : {},
      }),
    onSuccess: (data) => {
      setResult(data);
      setTitle('');
      setBody('');
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (window.confirm(`Send “${title}” to ${humanise(audience).toLowerCase()} users?`)) send.mutate();
  }

  return (
    <>
      <PageHeader title="Notifications" subtitle="Send an announcement. Users’ muted types and quiet hours are respected." />
      <form className="card card-pad" style={{ maxWidth: 640 }} onSubmit={submit}>
        <ErrorBox error={send.error} />
        {result ? <div className="success-box">Queued for {number(result.queued)} users{result.capped ? ' (capped at 50,000)' : ''}.</div> : null}
        <div className="field"><label htmlFor="title">Title</label><input id="title" className="input" required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="🎁 Birthday week deals are here" /></div>
        <div className="field"><label htmlFor="body">Message</label><textarea id="body" className="textarea" required maxLength={500} value={body} onChange={(event) => setBody(event.target.value)} /></div>
        <div className="field"><label htmlFor="link">Open in app (optional)</label><input id="link" className="input" value={deepLink} onChange={(event) => setDeepLink(event.target.value)} placeholder="gifts" /></div>
        <div className="row">
          <div className="field">
            <label htmlFor="audience">Audience</label>
            <select id="audience" className="select" value={audience} onChange={(event) => setAudience(event.target.value as typeof audience)}>
              <option value="ALL">All active users</option>
              <option value="PREMIUM">Premium members</option>
              <option value="VENDORS">Vendors</option>
              <option value="BIRTHDAY_SOON">Users with a birthday soon</option>
            </select>
          </div>
          {audience === 'BIRTHDAY_SOON' ? <div className="field"><label htmlFor="days">Within days</label><input id="days" className="input" type="number" min={0} max={366} value={days} onChange={(event) => setDays(Number(event.target.value))} /></div> : null}
        </div>
        <label style={{ display: 'flex', gap: 8, marginBottom: 14 }}><input type="checkbox" checked={sendPush} onChange={(event) => setSendPush(event.target.checked)} /> Also send a push notification</label>
        <button className="btn btn-primary" disabled={send.isPending}>{send.isPending ? 'Sending…' : 'Send'}</button>
      </form>
    </>
  );
}
