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
    const min = Number(poll.dataset.min) || 100;
    const question = poll.querySelector('[data-a]');
    const opts = poll.querySelector('.opts');
    const buttons = [...opts.querySelectorAll('button')];
    const status = poll.querySelector('.poll-status');

    let version = load(`poll:${id}:version`);
    if (version !== 'a' && version !== 'b') {
      version = Math.random() < 0.5 ? 'a' : 'b';
      save(`poll:${id}:version`, version);
    }
    const other = version === 'a' ? 'b' : 'a';
    const otherShort = poll.dataset[other + 'Short'];
    question.textContent = question.dataset[version];
    buttons.forEach((b) => (b.disabled = false));

    const show = (counts) => {
      const n = {};
      const pct = {};
      for (const v of ['a', 'b']) {
        const c = counts[v] || { yes: 0, no: 0 };
        n[v] = c.yes + c.no;
        pct[v] = n[v] ? Math.round((100 * c.yes) / n[v]) : 0;
      }
      const twist = document.createElement('strong');
      twist.textContent = 'Plot twist:';
      const rest = n.a < min || n.b < min
        ? ` others saw “${otherShort}.” Results at ${min} votes.`
        : ` others saw “${otherShort}.” You: ${pct[version]}% yes. Them: ${pct[other]}%.`;
      status.replaceChildren(twist, rest);
      poll.classList.add('done');
    };

    if (load(`poll:${id}:voted`)) {
      opts.hidden = true;
      post('results', { poll: id })
        .then((res) => res.ok && show(res.results))
        .catch(() => {});
    }

    for (const button of buttons) {
      button.addEventListener('click', async () => {
        buttons.forEach((b) => (b.disabled = true));
        status.textContent = 'Saving';
        status.classList.add('busy');
        try {
          const res = await post('vote', { poll: id, version, answer: button.dataset.answer });
          if (!res.ok) throw new Error(res.error);
          save(`poll:${id}:voted`, button.dataset.answer);
          opts.hidden = true;
          show(res.results);
        } catch {
          buttons.forEach((b) => (b.disabled = false));
          status.textContent = api ? 'Couldn’t save your answer. Try again?' : 'Voting opens soon.';
        } finally {
          status.classList.remove('busy');
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
