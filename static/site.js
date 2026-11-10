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
    const result = poll.querySelector('.poll-result');

    let version = load(`poll:${id}:version`);
    if (version !== 'a' && version !== 'b') {
      version = Math.random() < 0.5 ? 'a' : 'b';
      save(`poll:${id}:version`, version);
    }
    question.textContent = question.dataset[version];

    const mark = (answer) => {
      for (const b of buttons) {
        b.disabled = true;
        b.classList.toggle('pick', b.dataset.answer === answer);
        b.classList.toggle('dim', b.dataset.answer !== answer);
      }
    };
    const show = (counts) => {
      let yes = 0;
      let all = 0;
      for (const v of ['a', 'b']) {
        const c = counts[v] || { yes: 0, no: 0 };
        yes += c.yes;
        all += c.yes + c.no;
      }
      result.classList.remove('busy');
      if (all) result.textContent = `${Math.round((100 * yes) / all)}% of people would hire this AI agent.`;
    };

    const voted = load(`poll:${id}:voted`);
    if (voted) {
      mark(voted);
      post('results', { poll: id })
        .then((res) => res.ok && show(res.results))
        .catch(() => {});
    } else {
      buttons.forEach((b) => (b.disabled = false));
    }

    for (const button of buttons) {
      button.addEventListener('click', async () => {
        const answer = button.dataset.answer;
        mark(answer);
        result.textContent = '';
        result.classList.add('busy');
        try {
          const res = await post('vote', { poll: id, version, answer });
          if (!res.ok) throw new Error(res.error);
          save(`poll:${id}:voted`, answer);
          show(res.results);
        } catch {
          result.classList.remove('busy');
          for (const b of buttons) {
            b.disabled = false;
            b.classList.remove('pick', 'dim');
          }
          result.textContent = api ? 'Couldn’t save your answer. Try again?' : 'Voting opens soon.';
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
