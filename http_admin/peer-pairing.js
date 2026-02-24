const peerList = document.getElementById('peerList');
const pairedList = document.getElementById('pairedList');
const noPeers = document.getElementById('noPeers');
const noPaired = document.getElementById('noPaired');
const statusEl = document.getElementById('status');
const pairIpInput = document.getElementById('pairIpInput');
const pairPortInput = document.getElementById('pairPortInput');
const pairIpButton = document.getElementById('pairIpButton');
const manualToggleButton = document.getElementById('manualToggleButton');
const manualPairSection = document.getElementById('manualPairSection');
const peeringHelpButton = document.getElementById('peering-help-btn');
const pairingWrapper = document.getElementById('pairing-wrapper');
const followerDisabledOverlay = document.getElementById('follower-disabled-overlay');
const pinModalOverlay = document.getElementById('pinModalOverlay');
const pinModalInput = document.getElementById('pinModalInput');
const pinModalError = document.getElementById('pinModalError');
const pinModalCancel = document.getElementById('pinModalCancel');
const pinModalConfirm = document.getElementById('pinModalConfirm');
let followerModeEnabled = true;
let peeringInitialized = false;

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? '#ff9b9b' : '#9bdcff';
}

function setFollowerModeEnabled(enabled) {
  followerModeEnabled = enabled !== false;
  if (pairingWrapper) {
    pairingWrapper.classList.toggle('is-disabled', !followerModeEnabled);
  }
  if (followerDisabledOverlay) {
    followerDisabledOverlay.classList.toggle('is-hidden', followerModeEnabled);
  }
}

async function initializeFollowerMode() {
  if (!window.electronAPI?.getAppConfig) {
    setFollowerModeEnabled(true);
    return true;
  }
  try {
    const appConfig = await window.electronAPI.getAppConfig();
    const enabled = appConfig?.mdnsBrowse !== false;
    setFollowerModeEnabled(enabled);
    if (!enabled) {
      setStatus('Follower peering is disabled in settings.', true);
    }
    return enabled;
  } catch (err) {
    console.error('Failed to load app config for peering mode:', err);
    setFollowerModeEnabled(true);
    return true;
  }
}

async function refreshFollowerMode() {
  const wasEnabled = followerModeEnabled;
  const enabled = await initializeFollowerMode();
  if (enabled && !wasEnabled && !peeringInitialized) {
    const masters = await refreshPaired();
    const peers = await window.electronAPI.getMdnsPeers();
    renderPeers(peers, masters);
    peeringInitialized = true;
  }
  if (!enabled) {
    peeringInitialized = false;
  }
  return enabled;
}

function requestPairingPin() {
  return new Promise((resolve) => {
    if (!pinModalOverlay || !pinModalInput || !pinModalError || !pinModalCancel || !pinModalConfirm) {
      const pin = window.prompt('Enter pairing PIN');
      resolve(pin ? pin.trim() : null);
      return;
    }

    const cleanup = (result) => {
      pinModalOverlay.classList.add('is-hidden');
      pinModalError.textContent = '';
      pinModalInput.value = '';
      pinModalCancel.removeEventListener('click', onCancel);
      pinModalConfirm.removeEventListener('click', onConfirm);
      pinModalInput.removeEventListener('keydown', onKeyDown);
      pinModalOverlay.removeEventListener('click', onOverlayClick);
      resolve(result);
    };

    const onCancel = () => cleanup(null);

    const onConfirm = () => {
      const pin = pinModalInput.value.trim();
      if (!pin) {
        pinModalError.textContent = 'Pairing PIN is required.';
        pinModalInput.focus();
        return;
      }
      cleanup(pin);
    };

    const onKeyDown = (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        onConfirm();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
    };

    const onOverlayClick = (event) => {
      if (event.target === pinModalOverlay) onCancel();
    };

    pinModalOverlay.classList.remove('is-hidden');
    pinModalError.textContent = '';
    pinModalInput.value = '';
    pinModalCancel.addEventListener('click', onCancel);
    pinModalConfirm.addEventListener('click', onConfirm);
    pinModalInput.addEventListener('keydown', onKeyDown);
    pinModalOverlay.addEventListener('click', onOverlayClick);
    window.setTimeout(() => pinModalInput.focus(), 0);
  });
}

function renderPeers(allpeers, masters) {

  let peers = allpeers.filter(peer => {
    return !masters.find(master => 
      (master.instanceId && peer.txt && peer.txt.instanceId && master.instanceId === peer.txt.instanceId) ||
      (master.host === peer.host && (master.pairingPort === peer.port || master.pairingPort === peer.txt?.pairingPort))
    );
  });
  peerList.innerHTML = '';
  noPeers.style.display = peers.length ? 'none' : 'block';

  peers.forEach((peer) => {
    const li = document.createElement('li');
    li.className = 'peer-item';

    const meta = document.createElement('div');
    meta.className = 'peer-meta';
    const icon = document.createElement('div');
    icon.className = 'peer-icon';
    icon.textContent = '📡';
    const details = document.createElement('div');
    details.className = 'peer-meta-details';
    meta.appendChild(icon);
    meta.appendChild(details);
    const name = document.createElement('strong');
    name.textContent = peer.name || 'Unnamed';
    const host = document.createElement('small');
    host.textContent = `${peer.host || 'unknown'}:${peer.port || peer.txt?.pairingPort || ''}`;
    details.appendChild(name);
    details.appendChild(host);

    const button = document.createElement('button');
    button.textContent = 'Pair';
    button.addEventListener('click', async () => {
      const pin = await requestPairingPin();
      if (!pin) {
        setStatus('Pairing PIN is required.', true);
        return;
      }
      button.disabled = true;
      setStatus('Pairing...');
      try {
        await window.electronAPI.pairWithPeer({ ...peer, pairingPin: pin });
        setStatus('Paired successfully.');
        const masters = await refreshPaired();
        const peers = await window.electronAPI.getMdnsPeers();
        renderPeers(peers, masters);
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
    const icon = document.createElement('div');
    icon.className = 'peer-icon';
    if (master.host) {
      icon.textContent = '🌐';
    } else if (master.hostHint) {
      icon.textContent = '📌';
    } else {
      icon.textContent = '⛔';
    }
    meta.appendChild(icon);
    const details = document.createElement('div');
    details.className = 'peer-meta-details';
    meta.appendChild(details);
    const name = document.createElement('strong');
    name.textContent = master.name || master.instanceId || 'Unknown';
    const host = document.createElement('small');
    const displayHost = master.host || master.hostHint || 'unknown';
    const displayPort = master.pairingPort || master.pairingPortHint || '';
    host.textContent = `${displayHost}:${displayPort}`;
    details.appendChild(name);
    details.appendChild(host);


    const button = document.createElement('button');
    button.className = 'unpair-button';
    button.textContent = 'Unpair';
    button.addEventListener('click', async () => {
      button.disabled = true;
      setStatus('Unpairing...');
      try {
        await window.electronAPI.unpairPeer(master);
        setStatus('Unpaired successfully.');
        const masters = await refreshPaired();
        const peers = await window.electronAPI.getMdnsPeers();
        renderPeers(peers, masters);
      } catch (err) {
        setStatus(err.message || 'Unpairing failed.', true);
      } finally {
        button.disabled = false;
      }
    });

    li.appendChild(meta);
    li.appendChild(button);

    pairedList.appendChild(li);
  });
}

async function refreshPaired() {
  const masters = await window.electronAPI.getPairedMasters();
  renderPaired(masters);
  return masters;
}

async function pairByIp() {
  const host = pairIpInput?.value.trim();
  const portValue = pairPortInput?.value.trim();
  const port = portValue ? Number.parseInt(portValue, 10) : NaN;

  if (!host) {
    setStatus('IP address is required.', true);
    return;
  }
  if (!Number.isFinite(port) || port <= 0) {
    setStatus('Pairing port is required.', true);
    return;
  }

  const pin = await requestPairingPin();
  if (!pin) {
    setStatus('Pairing PIN is required.', true);
    return;
  }

  if (pairIpButton) pairIpButton.disabled = true;
  setStatus('Pairing...');
  try {
    await window.electronAPI.pairWithPeerByIp({ host, port, pairingPin: pin });
    setStatus('Paired successfully.');
    const masters = await refreshPaired();
    const peers = await window.electronAPI.getMdnsPeers();
    renderPeers(peers, masters);
  } catch (err) {
    setStatus(err.message || 'Pairing failed.', true);
  } finally {
    if (pairIpButton) pairIpButton.disabled = false;
  }
}

async function init() {
  const enabled = await refreshFollowerMode();
  if (!enabled) return;
  if (!peeringInitialized) {
    const masters = await refreshPaired();
    const peers = await window.electronAPI.getMdnsPeers();
    renderPeers(peers, masters);
    peeringInitialized = true;
  }
}

window.electronAPI.onMdnsPeersUpdated(async (peers) => {
  if (!followerModeEnabled) return;
  const masters = await refreshPaired();
  renderPeers(peers, masters);
});

document.addEventListener('DOMContentLoaded', () => {
  init();
  window.setInterval(() => {
    refreshFollowerMode().catch((err) => {
      console.error('Failed to refresh follower mode:', err);
    });
  }, 1500);
  window.addEventListener('focus', () => {
    refreshFollowerMode().catch((err) => {
      console.error('Failed to refresh follower mode on focus:', err);
    });
  });
  if (peeringHelpButton) {
    peeringHelpButton.addEventListener('click', () => {
      if (!window.electronAPI?.openHandoutView) {
        window.alert('Help is only available in the desktop app.');
        return;
      }
      window.electronAPI.openHandoutView('readme', 'doc-dev-peering.md').catch((err) => {
        console.error(err);
        window.alert(`Failed to open help: ${err.message || err}`);
      });
    });
  }
  if (pairIpButton) {
    pairIpButton.addEventListener('click', () => {
      if (!followerModeEnabled) return;
      pairByIp();
    });
  }
  if (manualToggleButton && manualPairSection) {
    manualToggleButton.addEventListener('click', () => {
      if (!followerModeEnabled) return;
      manualPairSection.classList.toggle('is-hidden');
    });
  }
});

window.translationsources.push('/admin/locales/translations.json');
