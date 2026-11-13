(() => {
  // Refuse to be shown inside another site's frame.
  if (window.top !== window.self) {
    document.body.hidden = true;
    return;
  }

  const api = document.body.dataset.api;

  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

  async function post(action, data) {
    if (!api) throw new Error('not connected');
    const res = await fetch(api, {
      method: 'POST',
      body: JSON.stringify({ action, ...data }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  function load(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }

  function save(key, value) {
    try { localStorage.setItem(key, value); } catch {}
  }

  // Contact form

  const form = document.getElementById('contact-form');
  if (form) {
    const started = Date.now();
    const status = form.querySelector('.status');
    const button = form.querySelector('button');
    button.disabled = false;

    if (new URLSearchParams(location.search).get('topic') === 'resume') {
      form.message.value = 'Hi, could I have the passcode for your resume?';
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(form));
      const email = d.email.trim();
      const message = d.message.trim();

      if (!/^[^\s@,;:<>()"\\]+@[^\s@,;:<>()"'\\]+\.[a-z]{2,}$/i.test(email)) {
        status.textContent = 'Enter your email so I can reply.';
        return;
      }
      if (!message) {
        status.textContent = 'Add a short message first.';
        return;
      }

      button.disabled = true;
      status.textContent = 'Sending';
      status.classList.add('busy');
      try {
        const res = await post('contact', {
          email,
          message,
          website: d.website,
          elapsed: Date.now() - started,
        });
        if (res.ok) {
          const sent = document.querySelector('.sent');
          sent.querySelector('.sent-note').textContent = 'Thanks for reaching out. I’ll reply to ' + email + '.';
          form.hidden = true;
          sent.hidden = false;
          sent.focus();
        } else if (res.error === 'busy') {
          status.textContent = 'Too many messages right now. Please try again later.';
        } else {
          status.textContent = 'Something went wrong. Please check the form and try again.';
        }
      } catch {
        status.textContent = api
          ? 'Couldn’t send. Check your connection and try again.'
          : 'The form isn’t connected yet.';
      } finally {
        status.classList.remove('busy');
        button.disabled = false;
      }
    });
  }

  // Poll: each visitor gets version a or b at random and keeps it.

  const poll = document.getElementById('poll');
  if (poll) {
    const id = poll.dataset.poll;
    const question = poll.querySelector('.poll-q');
    const buttons = [...poll.querySelectorAll('.opt')];
    const line = poll.querySelector('.poll-line');
    const face = {
      yes: '<path d="M6.5 9.5q1-1.2 2 0M11.5 9.5q1-1.2 2 0"/><path d="M7.5 12.5q2.5 2 5 0"/>',
      no: '<path d="M7.5 9.2v.6M12.5 9.2v.6"/><path d="M7.5 13.6q2.5-2 5 0"/>',
    };

    let version = load(`poll:${id}:version`);
    if (version !== 'a' && version !== 'b') {
      version = Math.random() < 0.5 ? 'a' : 'b';
      save(`poll:${id}:version`, version);
    }
    let voter = load('poll:voter');
    if (!/^[a-z0-9]{8,32}$/.test(voter || '')) {
      voter = [...crypto.getRandomValues(new Uint8Array(12))].map((n) => (n % 36).toString(36)).join('');
      save('poll:voter', voter);
    }
    question.textContent = question.dataset[version];

    let current = load(`poll:${id}:voted`);
    let counts = null;
    let pending = 0;
    try {
      const kept = JSON.parse(load(`poll:${id}:counts`));
      if (kept && kept.a && kept.b) counts = kept;
    } catch {}

    const mark = (answer) => {
      for (const b of buttons) {
        const on = b.dataset.answer === answer;
        b.classList.toggle('pick', Boolean(answer) && on);
        b.classList.toggle('dim', Boolean(answer) && !on);
        b.setAttribute('aria-pressed', String(Boolean(answer) && on));
      }
    };
    const show = () => {
      if (!current) return;
      if (!counts) {
        line.textContent = '';
        line.classList.add('busy');
        return;
      }
      line.classList.remove('busy');
      let yes = 0;
      let all = 0;
      for (const v of ['a', 'b']) {
        yes += counts[v].yes;
        all += counts[v].yes + counts[v].no;
      }
      poll.querySelector('.bot-face').innerHTML = face[current];
      line.textContent = '';
      const label = document.createElement('strong');
      label.textContent = current === 'yes' ? 'Hired.' : 'Not hired.';
      line.append(label);
      if (all) line.append(` ${Math.round((100 * yes) / all)}% hired it.`);
    };
    const tidy = (c) => {
      const out = {};
      for (const v of ['a', 'b']) out[v] = { yes: Math.max(0, (c && c[v] && c[v].yes) || 0), no: Math.max(0, (c && c[v] && c[v].no) || 0) };
      return out;
    };
    const keep = (c) => {
      counts = tidy(c);
      save(`poll:${id}:counts`, JSON.stringify(counts));
    };
    if (counts) counts = tidy(counts);

    post('results', { poll: id })
      .then((res) => {
        if (res.ok && !pending) {
          keep(res.results);
          show();
        }
      })
      .catch(() => {});

    buttons.forEach((b) => (b.disabled = false));
    if (current) {
      mark(current);
      show();
    }

    for (const button of buttons) {
      button.addEventListener('click', async () => {
        const answer = button.dataset.answer;
        if (answer === current) return;
        const previous = current;
        const before = counts && tidy(counts);
        current = answer;
        mark(answer);
        if (counts) {
          counts[version][answer]++;
          if (previous) counts[version][previous] = Math.max(0, counts[version][previous] - 1);
        }
        show();
        pending++;
        try {
          const res = await post('vote', { poll: id, version, answer, voter });
          if (!res.ok) throw new Error(res.error);
          save(`poll:${id}:voted`, answer);
          if (current === answer) {
            keep(res.results);
            show();
          }
        } catch {
          if (current !== answer) return;
          current = previous;
          counts = before;
          mark(previous);
          line.classList.remove('busy');
          line.textContent = api ? 'Couldn’t save your answer. Try again?' : 'Voting opens soon.';
        } finally {
          pending--;
        }
      });
    }
  }

  // Resume

  const unlock = document.getElementById('unlock-form');
  if (unlock) {
    const status = unlock.querySelector('.status');
    const button = unlock.querySelector('button');
    button.disabled = false;

    unlock.addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(unlock));
      const code = d.code.trim();
      if (!code) {
        status.textContent = 'Enter your passcode.';
        return;
      }

      button.disabled = true;
      status.textContent = 'Checking…';
      try {
        const res = await post('unlock', { code, who: d.who.trim() });
        if (res.ok) {
          const box = document.querySelector('.unlocked');
          box.innerHTML = res.html;
          box.hidden = false;
          document.querySelector('.locked').hidden = true;
        } else if (res.error === 'busy') {
          status.textContent = 'Too many tries. Please wait a few minutes.';
        } else {
          status.textContent = 'That passcode didn’t work, or it has expired.';
        }
      } catch {
        status.textContent = api ? "Couldn’t check right now. Try again?" : 'Resume access opens soon.';
      } finally {
        button.disabled = false;
      }
    });
  }
})();
