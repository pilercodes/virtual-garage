export async function setupGarageAccount(api, selectGarage) {
  const byId = id => document.getElementById(id);
  const status = byId('account-status');
  const picker = byId('garage-picker');
  const sharing = byId('sharing-panel');
  const credentials = byId('account-form');
  let account;
  let inviteToken = new URLSearchParams(location.hash.slice(1)).get('invite');
  if (inviteToken) history.replaceState(null, '', location.pathname);
  let currentGarage;

  function request(action, data) {
    return api('account/' + action, data === undefined ? {} : {
      method: 'POST', body: JSON.stringify(data)
    });
  }

  async function action(button, run) {
    status.textContent = '';
    button.disabled = true;
    try {
      await run();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }

  async function listMembers() {
    const members = await request('members');
    const rows = members.map(member => {
      const row = document.createElement('div');
      row.className = 'account-actions';
      const name = document.createElement('span');
      name.textContent = member.email + ' (unverified email)';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary';
      button.textContent = 'Remove access';
      button.addEventListener('click', () => action(button, async () => {
        await request('revoke', { id: member.id });
        await listMembers();
      }));
      row.append(name, button);
      return row;
    });
    byId('garage-members').replaceChildren(...rows);
  }

  async function refresh() {
    try {
      account = await request('me');
    } catch (error) {
      if (error.status !== 401) throw error;
      account = null;
    }
    byId('account-panel').hidden = Boolean(account);
    byId('garage-tools').hidden = !account || account.preview;
    byId('import-garage').hidden = !account?.canImport;
    if (!account) {
      currentGarage = undefined;
      sharing.hidden = true;
      await selectGarage(null);
      if (inviteToken) status.textContent = 'Sign in or create an account to join the shared garage.';
      return;
    }
    picker.replaceChildren(...account.garages.map(garage => new Option(garage.label, garage.id)));
    currentGarage = account.garages.some(garage => garage.id === currentGarage) ? currentGarage : account.garages[0].id;
    picker.value = currentGarage;
    await selectGarage(currentGarage);
    if (inviteToken) {
      sharing.hidden = false;
      byId('join-form').elements.namedItem('token').value = inviteToken;
      status.textContent = 'Review and join the invitation as ' + account.email + '. Sign out to switch accounts.';
      byId('join-form').querySelector('button').focus();
    }
  }

  async function join(token) {
    const garage = await request('join', { token });
    if (token === inviteToken) inviteToken = null;
    currentGarage = garage.id;
    await refresh();
    status.textContent = 'You joined the shared garage.';
  }

  credentials.addEventListener('submit', event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(credentials));
    const button = event.submitter;
    if (!button) return;
    for (const item of credentials.querySelectorAll('button')) item.disabled = true;
    action(button, async () => {
      await request(button.value, data);
      credentials.reset();
      await refresh();
    }).finally(() => {
      for (const item of credentials.querySelectorAll('button')) item.disabled = false;
    });
  });
  picker.addEventListener('change', async () => {
    currentGarage = picker.value;
    await selectGarage(currentGarage);
  });
  byId('sign-out').addEventListener('click', event => action(event.currentTarget, async () => {
    await request('logout', {});
    byId('invite-result').hidden = true;
    byId('invite-link').value = '';
    await refresh();
  }));
  byId('sharing-button').addEventListener('click', event => action(event.currentTarget, async () => {
    sharing.hidden = !sharing.hidden;
    if (!sharing.hidden) await listMembers();
  }));
  byId('create-invite').addEventListener('click', event => action(event.currentTarget, async () => {
    const { token } = await request('invite', {});
    byId('invite-link').value = location.origin + '/#invite=' + token;
    byId('invite-result').hidden = false;
    byId('invite-link').select();
  }));
  byId('join-form').addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    const value = new FormData(form).get('token').trim();
    const token = value.includes('#invite=') ? value.split('#invite=').at(-1) : value;
    action(event.submitter, async () => {
      await join(token);
      form.reset();
    });
  });
  byId('import-garage').addEventListener('click', event => action(event.currentTarget, async () => {
    await request('import', {});
    await refresh();
    byId('import-garage').hidden = true;
    status.textContent = 'Your existing garage was imported.';
  }));
  try {
    await refresh();
  } catch (error) {
    status.textContent = error.message;
  }
}
