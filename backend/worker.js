// 陈曼瑜主页 · 匿名统计后端（Cloudflare Workers + KV）
// 接收前端上报的预览/点赞事件，提供 /stats 后台页与 /stats.json 接口。
// 部署见 wrangler.toml 与说明。

function cors(){
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}
function json(o, status = 200){
  return new Response(JSON.stringify(o), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors() }
  });
}

export default {
  async fetch(request, env){
    const url = new URL(request.url);
    const p = url.pathname;

    // 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors() });
    }

    // 上报事件：POST /event  body: { kind:'view'|'like', visitorId, ts }
    if (request.method === 'POST' && p === '/event') {
      let body;
      try { body = await request.json(); } catch { return json({ ok:false, error:'bad json' }, 400); }
      const vid = String(body.visitorId || 'anon').slice(0, 64);
      const type = (body.kind === 'like') ? 'like' : 'view';
      const ts = Number(body.ts) || Date.now();
      const key = `${type}:${vid}:${ts}:${Math.random().toString(16).slice(2)}`;
      await env.EVENTS.put(key, JSON.stringify({ vid, type, ts }));
      // 累加计数
      const ckey = 'count_' + type;
      const cur = parseInt(await env.EVENTS.get(ckey) || '0', 10);
      await env.EVENTS.put(ckey, String(cur + 1));
      return json({ ok:true });
    }

    // 统计数据：GET /stats.json
    if (p === '/stats.json') {
      const views = parseInt(await env.EVENTS.get('count_view') || '0', 10);
      const likes = parseInt(await env.EVENTS.get('count_like') || '0', 10);
      const { keys } = await env.EVENTS.list({ limit: 1000 });
      const events = [];
      const vids = new Set();
      const now = Date.now();
      for (const k of keys) {
        if (k.name.startsWith('count_')) continue;
        const raw = await env.EVENTS.get(k.name);
        if (raw) { try { const e = JSON.parse(raw); events.push(e); vids.add(e.vid); } catch {} }
      }
      events.sort((a, b) => b.ts - a.ts);
      const last24h = events.filter(e => now - e.ts < 24*3600*1000).length;
      return json({ summary: { totalViews: views, totalLikes: likes, uniqueVisitors: vids.size, eventsLast24h: last24h }, events: events.slice(0, 300) });
    }

    // 后台页：GET /stats
    if (p === '/stats') {
      const views = parseInt(await env.EVENTS.get('count_view') || '0', 10);
      const likes = parseInt(await env.EVENTS.get('count_like') || '0', 10);
      const { keys } = await env.EVENTS.list({ limit: 1000 });
      const events = [];
      for (const k of keys) {
        if (k.name.startsWith('count_')) continue;
        const raw = await env.EVENTS.get(k.name);
        if (raw) { try { events.push(JSON.parse(raw)); } catch {} }
      }
      events.sort((a, b) => b.ts - a.ts);
      const rows = events.slice(0, 200).map(e => {
        const short = String(e.vid).slice(0, 8);
        const t = new Date(e.ts).toLocaleString('zh-CN', { hour12:false });
        const act = e.type === 'like' ? '👍 点赞' : '👁 预览';
        return `<tr><td>${short}</td><td>${act}</td><td>${t}</td></tr>`;
      }).join('');
      const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>陈曼瑜主页 · 访问统计</title>
<style>
 body{font-family:PingFang SC,Microsoft YaHei,sans-serif;background:#cdaf80;color:#1a1a1a;margin:0;padding:24px}
 .card{background:#f3eddc;border:3px solid #1a1a1a;border-radius:6px;padding:18px 22px;max-width:760px;margin:0 auto 16px;box-shadow:inset 3px 3px 0 rgba(255,255,255,.5)}
 h1{font-size:22px;margin:0 0 12px}
 .nums{display:flex;gap:16px;margin-bottom:8px}
 .num{flex:1;background:#d6d6d6;border:3px solid #1a1a1a;border-radius:6px;padding:14px;text-align:center}
 .num b{display:block;font-size:30px}
 table{width:100%;border-collapse:collapse;margin-top:8px;font-size:14px}
 th,td{border:1px solid #1a1a1a;padding:8px 10px;text-align:left}
 th{background:#e8c34a}
 tr:nth-child(even){background:#efe7d2}
</style></head><body>
 <div class="card">
  <h1>陈曼瑜主页 · 访问统计后台</h1>
  <div class="nums">
   <div class="num">👁 预览<b>${views}</b></div>
   <div class="num">👍 点赞<b>${likes}</b></div>
  </div>
  <p style="opacity:.7;font-size:13px">访客以匿名 ID 记录（前 8 位），无真实姓名。刷新页面会再记一次预览。</p>
 </div>
 <div class="card">
  <h1>最近事件</h1>
  <table><thead><tr><th>访客ID</th><th>动作</th><th>时间</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="3">暂无数据</td></tr>'}</tbody></table>
 </div>
</body></html>`;
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', ...cors() } });
    }

    return new Response('Not found', { status: 404, headers: cors() });
  }
};
