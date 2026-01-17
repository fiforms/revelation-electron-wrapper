const peerList = document.getElementById('peerList');
const pairedList = document.getElementById('pairedList');
const noPeers = document.getElementById('noPeers');
const noPaired = document.getElementById('noPaired');
const statusEl = document.getElementById('status');

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? '#ff9b9b' : '#9bdcff';
}

function renderPeers(peers) {
  peerList.innerHTML = '';
  noPeers.style.display = peers.length ? 'none' : 'block';

  peers.forEach((peer) => {
    const li = document.createElement('li');
    li.className = 'peer-item';

    const meta = document.createElement('div');
    meta.className = 'peer-meta';
    const name = document.createElement('strong');
    name.textContent = peer.name || 'Unnamed';
    const host = document.createElement('small');
    host.textContent = `${peer.host || 'unknown'}:${peer.port || peer.txt?.pairingPort || ''}`;
    meta.appendChild(name);
    meta.appendChild(host);

    const button = document.createElement('button');
    button.textContent = 'Pair';
    button.addEventListener('click', async () => {
      button.disabled = true;
      setStatus('Pairing...');
      try {
        await window.electronAPI.pairWithPeer(peer);
        setStatus('Paired successfully.');
        await refreshPaired();
      } catch (err) {
        setStatus(err.message || 'Pairing failed.', true);
      } finally {
        button.disabled = false;
      }
    });

    li.appendChild(meta);
    li.appendChild(button);
    peerList.appendChild(li);
  });
}

function renderPaired(masters) {
  pairedList.innerHTML = '';
  noPaired.style.display = masters.length ? 'none' : 'block';

  masters.forEach((master) => {
    const li = document.createElement('li');
    li.className = 'peer-item';

    const meta = document.createElement('div');
    meta.className = 'peer-meta';
    const name = document.createElement('strong');
    name.textContent = master.name || master.instanceId || 'Unknown';
    const host = document.createElement('small');
    host.textContent = `${master.host || 'unknown'}:${master.pairingPort || ''}`;
    meta.appendChild(name);
    meta.appendChild(host);

    li.appendChild(meta);
    pairedList.appendChild(li);
  });
}

async function refreshPaired() {
  const masters = await window.electronAPI.getPairedMasters();
  renderPaired(masters);
}

async function init() {
  const peers = await window.electronAPI.getMdnsPeers();
  renderPeers(peers);
  await refreshPaired();
}

window.electronAPI.onMdnsPeersUpdated((peers) => {
  renderPeers(peers);
});

document.addEventListener('DOMContentLoaded', () => {
  init();
});

window.translationsources.push('/admin/locales/translations.json');
