// Register Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(err => console.error('SW registration failed:', err));
    });
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

// Supabase Setup 
const SUPABASE_URL = 'https://pfxctthvgniihdcsjevi.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_RV3n7SYVyE3LxAYdhpWJrQ_OKSsLwQX';
const supabaseClient = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

// LOCAL STATE & CACHING
let localPlants = [];
const CACHE_KEY = 'plant_tracker_data';

// Control States
let currentFilter = 'all';
let currentSort = 'urgency';

const dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open('PlantTrackerDB', 1);
    request.onupgradeneeded = event => {
        event.target.result.createObjectStore('keyval');
    };
    request.onsuccess = event => resolve(event.target.result);
    request.onerror = event => reject(event.target.error);
});

async function idbSet(key, val) {
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
        const tx = db.transaction('keyval', 'readwrite');
        tx.objectStore('keyval').put(val, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function idbGet(key) {
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
        const tx = db.transaction('keyval', 'readonly');
        const req = tx.objectStore('keyval').get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(tx.error);
    });
}

function syncLocalCache() {
    idbSet(CACHE_KEY, localPlants).catch(e => console.error('IDB sync error', e));
}

async function initDB() {
    try {
        const cachedData = await idbGet(CACHE_KEY);
        if (cachedData) {
            localPlants = cachedData;
            renderPlants();
        }
    } catch (e) {
        console.error('Cache parsing error', e);
    }

    if (supabaseClient) {
        try {
            localPlants = await getAllPlants();
            syncLocalCache();
            renderPlants();
        } catch (err) {
            console.error('Failed to fetch fresh data from Supabase', err);
        }
    }

    if (new URLSearchParams(window.location.search).get('action') === 'add') {
        addModal.classList.add('show');
    }
}

// DB Operations
async function getAllPlants() {
    if (!supabaseClient) return [];
    const { data, error } = await supabaseClient.from('plants').select('*').order('id', { ascending: true });
    if (error) throw error;
    return data || [];
}

async function savePlant(plant) {
    if (!supabaseClient) return plant;
    if (plant.id) {
        const { data, error } = await supabaseClient.from('plants').update(plant).eq('id', plant.id).select().single();
        if (error) throw error;
        return data;
    } else {
        const { data, error } = await supabaseClient.from('plants').insert([plant]).select().single();
        if (error) throw error;
        return data;
    }
}

async function deletePlantFromDB(id) {
    if (!supabaseClient) return;
    const { error } = await supabaseClient.from('plants').delete().eq('id', id);
    if (error) throw error;
}

// DOM Elements
const plantListEl = document.getElementById('plant-list');
const addModal = document.getElementById('add-modal');
const addBtn = document.getElementById('add-btn');
const cancelAddBtn = document.getElementById('cancel-add-btn');
const addForm = document.getElementById('add-form');

const profileModal = document.getElementById('profile-modal');
const closeProfileBtn = document.getElementById('close-profile-btn');
const profileEditBtn = document.getElementById('profile-edit-btn');
const profileWaterBtn = document.getElementById('profile-water-btn');
const profileFertBtn = document.getElementById('profile-fert-btn');
const historyContainer = document.getElementById('profile-history-container');
const fertHistoryContainer = document.getElementById('profile-fert-history-container');
const fertHistoryGroup = document.getElementById('profile-fert-history-group');

const editModal = document.getElementById('edit-modal');
const cancelEditBtn = document.getElementById('cancel-edit-btn');
const editForm = document.getElementById('edit-form');
const deleteBtn = document.getElementById('delete-btn');
const removePhotoBtn = document.getElementById('remove-photo-btn');

const toastEl = document.getElementById('toast');
const toastMessageEl = document.getElementById('toast-message');
const toastUndoBtn = document.getElementById('toast-undo');

const searchInput = document.getElementById('search-input');
const waterAllBtn = document.getElementById('water-all-btn');

let toastTimeout;
let activeUndoAction = null;
let currentProfilePlantId = null;
let pendingPhotoRemoval = false;

// Utilities
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
}

async function ensurePermissions() {
    if (!('Notification' in window) || !supabaseClient) return;
    if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
        try { await Notification.requestPermission(); } catch (e) {}
    }
    if (Notification.permission === 'granted') {
        try {
            const reg = await navigator.serviceWorker.ready;
            let subscription = await reg.pushManager.getSubscription();
            if (!subscription) {
                const publicVapidKey = 'BOeEj0z9GYULAs84kxllq63lwRTCzK_3ebaRr14g_ElZb9RDCBrsGHlyOKketrTrt0RI79PyO5614gqEt4UhkaU';
                subscription = await reg.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(publicVapidKey)
                });
                await supabaseClient.from('push_subscriptions').upsert([{ subscription: subscription.toJSON() }], { onConflict: 'subscription' });
            }
        } catch (error) {}
    }
}

function updateAppBadgeAndNotify(plants) {
    let overdueCount = 0;
    const now = Date.now();
    plants.forEach(plant => {
        const { daysLeft } = plant.computedStatus || calculatePlantStatus(plant, now);
        if (daysLeft <= 0) overdueCount++;
    });

    if ('setAppBadge' in navigator) {
        try { overdueCount > 0 ? navigator.setAppBadge(overdueCount) : navigator.clearAppBadge(); } catch (e) {}
    }
}

function showToast(message, undoCallback = null) {
    clearTimeout(toastTimeout);
    toastMessageEl.textContent = message;
    if (undoCallback) {
        toastUndoBtn.style.display = 'block';
        activeUndoAction = undoCallback;
    } else {
        toastUndoBtn.style.display = 'none';
        activeUndoAction = null;
    }
    toastEl.classList.add('show');
    toastTimeout = setTimeout(() => {
        toastEl.classList.remove('show');
        activeUndoAction = null;
    }, 4000);
}

toastUndoBtn.addEventListener('click', () => {
    if (activeUndoAction) {
        activeUndoAction();
        toastEl.classList.remove('show');
        activeUndoAction = null;
    }
});

function compressImage(file, maxWidth = 800, quality = 0.7) {
    return new Promise((resolve, reject) => {
        if (!file) { resolve(null); return; }
        const reader = new FileReader();
        reader.onload = event => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', quality)); 
            };
            img.onerror = reject;
            img.src = event.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function isSummer(dateObj = new Date()) {
    const month = dateObj.getMonth();
    return month >= 3 && month <= 8; // April (3) to Sept (8)
}

function getMidnightTS(ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

function calculatePlantStatus(plant, now) {
    const todayTS = getMidnightTS(now);
    
    const lastWateredRaw = plant.history && plant.history.length > 0 ? plant.history[plant.history.length - 1] : plant.lastWatered;
    const lastWateredTS = getMidnightTS(lastWateredRaw);
    
    const baseNextWaterDate = lastWateredTS + (plant.interval * MS_PER_DAY);
    const snoozedTS = plant.snoozedUntil ? getMidnightTS(plant.snoozedUntil) : 0;
    const nextWaterDate = Math.max(baseNextWaterDate, snoozedTS);
    
    const daysLeft = Math.round((nextWaterDate - todayTS) / MS_PER_DAY);
    const totalIntervalDays = Math.round((nextWaterDate - lastWateredTS) / MS_PER_DAY);

    // Fertilizer
    const lastFertilizedRaw = plant.fertilizerHistory && plant.fertilizerHistory.length > 0 ? plant.fertilizerHistory[plant.fertilizerHistory.length - 1] : (plant.lastFertilized || now);
    const lastFertilizedTS = getMidnightTS(lastFertilizedRaw);
    const currentSeasonWeeks = isSummer(new Date(now)) ? plant.summerFertilizer : plant.winterFertilizer;
    
    let fertilizerDaysLeft = null;
    let nextFertilizeDate = null;
    if (currentSeasonWeeks && currentSeasonWeeks > 0) {
        const intervalDays = currentSeasonWeeks * 7;
        nextFertilizeDate = lastFertilizedTS + (intervalDays * MS_PER_DAY);
        fertilizerDaysLeft = Math.round((nextFertilizeDate - todayTS) / MS_PER_DAY);
    }

    return { 
        lastWatered: lastWateredRaw, 
        nextWaterDate, 
        daysLeft, 
        totalIntervalDays, 
        lastFertilized: lastFertilizedRaw, 
        fertilizerDaysLeft, 
        nextFertilizeDate 
    };
}

function renderHistoryList(historyArray, containerEl, icon, label) {
    containerEl.innerHTML = '';
    if (!historyArray || historyArray.length === 0) {
        containerEl.innerHTML = `<div class="history-item">No ${label.toLowerCase()} history yet.</div>`;
        return;
    }
    const sortedHistory = [...historyArray].sort((a, b) => b - a);
    sortedHistory.forEach((timestamp) => {
        const date = new Date(timestamp);
        const formattedDate = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        const div = document.createElement('div');
        div.className = 'history-item';
        div.innerHTML = `<span>${icon} ${label}</span> <span>${formattedDate}</span>`;
        containerEl.appendChild(div);
    });
}

// Segmented Control Logic
document.querySelectorAll('.segmented-control .segment').forEach(btn => {
    btn.addEventListener('click', e => {
        const parent = e.target.closest('.segmented-control');
        parent.querySelectorAll('.segment').forEach(s => s.classList.remove('active'));
        e.target.classList.add('active');
        
        if (parent.id === 'filter-control') currentFilter = e.target.getAttribute('data-val');
        if (parent.id === 'sort-control') currentSort = e.target.getAttribute('data-val');
        
        renderPlants();
    });
});

// Optimistic Action Handlers
function handleWater(plantId, skipRender = false) {
    ensurePermissions(); 
    
    const plantIndex = localPlants.findIndex(p => p.id === plantId);
    if (plantIndex === -1) return;
    
    const plant = localPlants[plantIndex];
    const oldState = JSON.parse(JSON.stringify(plant)); 
    
    const now = Date.now();
    plant.lastWatered = now;
    if (!plant.history) plant.history = [];
    plant.history.push(now);
    plant.snoozedUntil = null; 
    
    syncLocalCache();
    if (!skipRender) renderPlants(); 
    
    showToast(`${plant.name} watered!`, () => {
        localPlants[plantIndex] = oldState;
        syncLocalCache();
        renderPlants();
        savePlant(oldState); 
        showToast('Watering undone.');
    });
    
    savePlant(plant).catch(e => console.error("Background sync failed", e)); 
}

function handleSnooze(plantId) {
    const plantIndex = localPlants.findIndex(p => p.id === plantId);
    if (plantIndex === -1) return;
    
    const plant = localPlants[plantIndex];
    const oldState = JSON.parse(JSON.stringify(plant)); 
    
    const lastWatered = plant.history && plant.history.length > 0 ? plant.history[plant.history.length - 1] : plant.lastWatered;
    const currentTarget = Math.max(lastWatered + (plant.interval * MS_PER_DAY), plant.snoozedUntil || 0, Date.now());
    plant.snoozedUntil = currentTarget + MS_PER_DAY;
    
    syncLocalCache();
    renderPlants(); 
    
    showToast(`${plant.name} snoozed for 1 day.`, () => {
        localPlants[plantIndex] = oldState;
        syncLocalCache();
        renderPlants();
        savePlant(oldState);
        showToast('Snooze undone.');
    });
    
    savePlant(plant).catch(e => console.error(e));
}

function handleFertilize(plantId, skipRender = false) {
    const plantIndex = localPlants.findIndex(p => p.id === plantId);
    if (plantIndex === -1) return;
    
    const plant = localPlants[plantIndex];
    const oldState = JSON.parse(JSON.stringify(plant)); 
    
    const now = Date.now();
    plant.lastFertilized = now;
    if (!plant.fertilizerHistory) plant.fertilizerHistory = [];
    plant.fertilizerHistory.push(now);
    
    syncLocalCache();
    if (!skipRender) renderPlants(); 
    
    showToast(`${plant.name} fed!`, () => {
        localPlants[plantIndex] = oldState;
        syncLocalCache();
        renderPlants();
        savePlant(oldState); 
        showToast('Feeding undone.');
    });
    
    savePlant(plant).catch(e => console.error(e)); 
}

// Synchronous Core Rendering
function renderPlants() {
    plantListEl.innerHTML = '';
    const now = Date.now();
    
    let plants = localPlants.map(plant => ({ ...plant, computedStatus: calculatePlantStatus(plant, now) }));
    updateAppBadgeAndNotify(plants);

    const searchTerm = searchInput.value.toLowerCase();
    if (searchTerm) plants = plants.filter(p => p.name.toLowerCase().includes(searchTerm) || (p.species && p.species.toLowerCase().includes(searchTerm)));

    let dueCount = 0;
    if (currentFilter === 'due') {
        plants = plants.filter(p => p.computedStatus.daysLeft <= 0 || (p.computedStatus.fertilizerDaysLeft !== null && p.computedStatus.fertilizerDaysLeft <= 0));
    }
    
    localPlants.forEach(p => { if (calculatePlantStatus(p, now).daysLeft <= 0) dueCount++; });
    waterAllBtn.style.display = dueCount > 0 && plants.length > 0 ? 'block' : 'none';

    if (currentSort === 'urgency') plants.sort((a, b) => a.computedStatus.nextWaterDate - b.computedStatus.nextWaterDate);
    else if (currentSort === 'name') plants.sort((a, b) => a.name.localeCompare(b.name));

    if (plants.length === 0) {
        plantListEl.innerHTML = `
            <div style="text-align: center; padding: 60px 20px; color: var(--text-secondary);">
                <div style="font-size: 54px; margin-bottom: 16px;">🌱</div>
                <h3 style="color: var(--text-primary); margin-bottom: 8px;">No Plants Found</h3>
            </div>
        `;
        return;
    }

    plants.forEach(plant => {
        const { daysLeft, totalIntervalDays, lastWatered, fertilizerDaysLeft } = plant.computedStatus;
        
        let statusText = '';
        let isOverdue = false;
        let progressPercent = 100;
        let progressColor = 'var(--accent-color)';

        if (daysLeft < 0) {
            statusText = `Overdue by ${Math.abs(daysLeft)} day(s)`;
            isOverdue = true;
            progressColor = 'var(--danger-color)';
        } else if (daysLeft === 0) {
            statusText = 'Water today';
            isOverdue = true;
            progressColor = 'var(--warning-color)';
        } else {
            statusText = `Water in ${daysLeft} day(s)`;
            const daysElapsed = totalIntervalDays - daysLeft;
            progressPercent = Math.max(0, Math.min(100, (daysElapsed / totalIntervalDays) * 100));
        }

        let fertHtml = '';
        if (fertilizerDaysLeft !== null) {
            let fertStatusText = '';
            let fertColor = 'var(--fert-color)';
            if (fertilizerDaysLeft < 0) {
                fertStatusText = `Feed overdue by ${Math.abs(fertilizerDaysLeft)} day(s)`;
                fertColor = 'var(--danger-color)';
            } else if (fertilizerDaysLeft === 0) {
                fertStatusText = 'Feed today';
                fertColor = 'var(--warning-color)';
            } else {
                fertStatusText = `Feed in ${fertilizerDaysLeft} day(s)`;
            }
            fertHtml = `
                <div class="status-row">
                    <p class="plant-status" style="color: ${fertColor}; font-size: 13px;">✨ ${fertStatusText}</p>
                </div>
            `;
        }

        const lastWateredFormatted = new Date(lastWatered).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        const photoHtml = plant.photo ? `<img src="${plant.photo}" alt="${plant.name}">` : `🌱`;

        const card = document.createElement('div');
        card.className = 'plant-card';
        card.setAttribute('data-id', plant.id);
        
        card.innerHTML = `
            <div class="card-background">
                <div class="bg-action bg-water">💧 Water</div>
                <div class="bg-action bg-snooze">💤 Snooze</div>
            </div>
            <div class="card-foreground">
                <div class="plant-header">
                    <div class="plant-photo-ring" style="background: conic-gradient(${progressColor} ${progressPercent}%, var(--divider-color) 0);">
                        <div class="plant-photo-container">${photoHtml}</div>
                    </div>
                    <div class="plant-info">
                        <h3>${plant.name}</h3>
                        ${plant.species ? `<div class="plant-species">${plant.species}</div>` : ''}
                        
                        <div class="status-row">
                            <p class="plant-status ${isOverdue ? 'overdue' : ''}" style="color: ${progressColor};">${statusText}</p>
                        </div>
                        ${fertHtml}
                        <div class="last-watered-text">Last watered: ${lastWateredFormatted}</div>
                    </div>
                </div>
            </div>
        `;
        plantListEl.appendChild(card);
    });
}

searchInput.addEventListener('input', renderPlants);

waterAllBtn.addEventListener('click', () => {
    ensurePermissions();
    const now = Date.now();
    let wateredCount = 0;
    const oldPlantsState = JSON.parse(JSON.stringify(localPlants));

    localPlants.forEach(plant => {
        const { daysLeft } = calculatePlantStatus(plant, now);
        if (daysLeft <= 0) {
            plant.lastWatered = now;
            if (!plant.history) plant.history = [];
            plant.history.push(now);
            plant.snoozedUntil = null;
            savePlant(plant); 
            wateredCount++;
        }
    });

    if (wateredCount > 0) {
        syncLocalCache();
        renderPlants();
        showToast(`Watered ${wateredCount} plant(s)!`, () => {
            localPlants = oldPlantsState;
            syncLocalCache();
            renderPlants();
            localPlants.forEach(p => savePlant(p));
            showToast('Bulk watering undone.');
        });
    }
});

// Add Plant
addBtn.addEventListener('click', () => addModal.classList.add('show'));
cancelAddBtn.addEventListener('click', () => {
    addModal.classList.remove('show');
    setTimeout(() => addForm.reset(), 300); 
});

addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    ensurePermissions(); 
    
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.textContent = 'Saving...';
    submitBtn.disabled = true;

    const fileInput = document.getElementById('plant-photo');
    let photoDataUrl = null;
    if (fileInput.files.length > 0) photoDataUrl = await compressImage(fileInput.files[0]);

    const name = document.getElementById('plant-name').value;
    const species = document.getElementById('plant-species').value;
    const interval = parseInt(document.getElementById('water-interval').value, 10);
    const summerFertilizer = parseInt(document.getElementById('plant-summer-fert').value, 10) || 0;
    const winterFertilizer = parseInt(document.getElementById('plant-winter-fert').value, 10) || 0;
    
    const now = Date.now();
    
    const plantPayload = {
        name, 
        species, 
        interval, 
        summerFertilizer,
        winterFertilizer,
        lastWatered: now, 
        history: [now], 
        lastFertilized: (summerFertilizer > 0 || winterFertilizer > 0) ? now : null,
        fertilizerHistory: (summerFertilizer > 0 || winterFertilizer > 0) ? [now] : [],
        snoozedUntil: null, 
        photo: photoDataUrl
    };

    const tempId = Date.now(); 
    let savedPlant = { ...plantPayload, id: tempId };

    try {
        savedPlant = await savePlant(plantPayload);
    } catch (err) {
        console.error('Failed to sync to Supabase, saving locally only', err);
    }

    localPlants.push(savedPlant);
    syncLocalCache();
    renderPlants();
    
    addModal.classList.remove('show');
    setTimeout(() => {
        addForm.reset();
        submitBtn.textContent = 'Save';
        submitBtn.disabled = false;
    }, 300);
    showToast(`${name} added!`);
});

// Profile View Logic
function openProfileModal(plantId) {
    const plant = localPlants.find(p => p.id === plantId);
    if (!plant) return;
    
    currentProfilePlantId = plantId;
    const { daysLeft, fertilizerDaysLeft } = calculatePlantStatus(plant, Date.now());

    document.getElementById('profile-name').textContent = plant.name;
    document.getElementById('profile-species').textContent = plant.species || '';
    document.getElementById('profile-interval-text').textContent = plant.interval;
    
    const statusTextEl = document.getElementById('profile-status-text');
    const statusIconEl = document.getElementById('profile-status-icon');
    
    if (daysLeft < 0) {
        statusTextEl.textContent = `Overdue by ${Math.abs(daysLeft)} day(s)`;
        statusTextEl.style.color = 'var(--danger-color)';
        statusIconEl.textContent = '🚨';
    } else if (daysLeft === 0) {
        statusTextEl.textContent = 'Water today';
        statusTextEl.style.color = 'var(--warning-color)';
        statusIconEl.textContent = '💧';
    } else {
        statusTextEl.textContent = `Water in ${daysLeft} day(s)`;
        statusTextEl.style.color = 'var(--text-primary)';
        statusIconEl.textContent = '⏳';
    }

    const fertBox = document.getElementById('profile-fert-box');
    const fertTextEl = document.getElementById('profile-fert-text');
    if (fertilizerDaysLeft !== null) {
        fertBox.style.display = 'inline-flex';
        profileFertBtn.style.display = 'block';
        fertHistoryGroup.style.display = 'block';
        
        document.getElementById('profile-summer-fert-text').textContent = plant.summerFertilizer || 0;
        document.getElementById('profile-winter-fert-text').textContent = plant.winterFertilizer || 0;

        if (fertilizerDaysLeft < 0) {
            fertTextEl.textContent = `Feed overdue by ${Math.abs(fertilizerDaysLeft)} day(s)`;
            fertTextEl.style.color = 'var(--danger-color)';
        } else if (fertilizerDaysLeft === 0) {
            fertTextEl.textContent = 'Feed today';
            fertTextEl.style.color = 'var(--warning-color)';
        } else {
            fertTextEl.textContent = `Feed in ${fertilizerDaysLeft} day(s)`;
            fertTextEl.style.color = 'var(--text-primary)';
        }
    } else {
        fertBox.style.display = 'none';
        profileFertBtn.style.display = 'none';
        fertHistoryGroup.style.display = 'none';
    }

    const headerImg = document.getElementById('profile-header-img');
    const placeholder = document.getElementById('profile-placeholder-emoji');
    if (plant.photo) {
        headerImg.style.backgroundImage = `url(${plant.photo})`;
        placeholder.style.display = 'none';
    } else {
        headerImg.style.backgroundImage = 'none';
        placeholder.style.display = 'block';
    }

    renderHistoryList(plant.history || [plant.lastWatered], historyContainer, '💧', 'Watered');
    if (fertilizerDaysLeft !== null) {
        renderHistoryList(plant.fertilizerHistory || [plant.lastFertilized], fertHistoryContainer, '✨', 'Fed');
    }

    profileModal.classList.add('show');
}

closeProfileBtn.addEventListener('click', () => {
    profileModal.classList.remove('show');
    currentProfilePlantId = null;
});

profileWaterBtn.addEventListener('click', () => {
    if (!currentProfilePlantId) return;
    handleWater(currentProfilePlantId, true);
    openProfileModal(currentProfilePlantId); 
    renderPlants();
});

profileFertBtn.addEventListener('click', () => {
    if (!currentProfilePlantId) return;
    handleFertilize(currentProfilePlantId, true);
    openProfileModal(currentProfilePlantId); 
    renderPlants();
});

profileEditBtn.addEventListener('click', () => {
    if (!currentProfilePlantId) return;
    const plant = localPlants.find(p => p.id === currentProfilePlantId);
    
    document.getElementById('edit-plant-id').value = plant.id;
    document.getElementById('edit-plant-name').value = plant.name;
    document.getElementById('edit-plant-species').value = plant.species || '';
    document.getElementById('edit-water-interval').value = plant.interval;
    document.getElementById('edit-summer-fert').value = plant.summerFertilizer || '';
    document.getElementById('edit-winter-fert').value = plant.winterFertilizer || '';
    
    pendingPhotoRemoval = false;
    const preview = document.getElementById('edit-photo-preview');
    if (plant.photo) {
        preview.src = plant.photo;
        preview.style.display = 'block';
        removePhotoBtn.style.display = 'inline-block';
    } else {
        preview.style.display = 'none';
        removePhotoBtn.style.display = 'none';
    }

    profileModal.classList.remove('show');
    editModal.classList.add('show');
});

// Photo Removal
removePhotoBtn.addEventListener('click', () => {
    document.getElementById('edit-photo-preview').style.display = 'none';
    document.getElementById('edit-plant-photo').value = '';
    removePhotoBtn.style.display = 'none';
    pendingPhotoRemoval = true;
});


// PULL-TO-REFRESH
const ptrIndicator = document.getElementById('ptr-indicator');
const ptrIcon = ptrIndicator.querySelector('.ptr-icon');
const ptrText = document.getElementById('ptr-text');
let ptrStartY = 0, ptrCurrentY = 0, isPtrPulling = false;

document.addEventListener('touchstart', e => {
    if (window.scrollY <= 0) {
        ptrStartY = e.touches[0].clientY;
        isPtrPulling = true;
    }
}, { passive: true });

document.addEventListener('touchmove', e => {
    if (!isPtrPulling) return;
    const currentY = e.touches[0].clientY;
    
    if (currentY > ptrStartY && window.scrollY <= 0) {
        ptrCurrentY = (currentY - ptrStartY) * 0.4;
        const maxPull = Math.min(ptrCurrentY, 65); // Cap the visual translation
        
        ptrIndicator.style.transform = `translateY(${maxPull}px)`;
        plantListEl.style.transform = `translateY(${maxPull}px)`;
        ptrIcon.style.transform = `rotate(${maxPull * 3}deg)`;
        
        if (maxPull > 50) {
            ptrText.textContent = 'Release to refresh';
        } else {
            ptrText.textContent = 'Pull to refresh';
        }
    }
}, { passive: true });

document.addEventListener('touchend', async () => {
    if (!isPtrPulling) return;
    isPtrPulling = false;
    
    if (ptrCurrentY > 50) {
        ptrText.textContent = 'Refreshing...';
        ptrIcon.style.animation = 'spin 1s linear infinite';
        
        try {
            if (supabaseClient) {
                localPlants = await getAllPlants();
                syncLocalCache();
                renderPlants();
            }
        } catch (e) {
            console.error('Refresh failed', e);
        }
        
        ptrIcon.style.animation = 'none';
        ptrText.textContent = 'Pull to refresh';
    }
    
    ptrCurrentY = 0;
    ptrIndicator.style.transition = 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
    plantListEl.style.transition = 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
    ptrIndicator.style.transform = `translateY(0)`;
    plantListEl.style.transform = `translateY(0)`;
    
    setTimeout(() => {
        ptrIndicator.style.transition = 'none';
        plantListEl.style.transition = 'none';
    }, 300);
});


// SWIPE GESTURES
let startX = 0;
let startY = 0;
let currentX = 0;
let rawX = 0;
let swipingCard = null;
let bgWater = null;
let bgSnooze = null;
let wasSwiped = false; 
let isSwiping = false;
let isVerticalScroll = false;

function swipeLoop() {
    if (!isSwiping || !swipingCard || isVerticalScroll) return;

    // Apply native-feeling progressive rubber-band resistance
    const baseRawX = Math.abs(rawX);
    const resistedX = Math.pow(baseRawX, 0.85); 
    currentX = rawX > 0 ? resistedX : -resistedX;

    // Apply subtle UI scale to increase the feeling of resistance
    const scale = Math.max(0.92, 1 - (baseRawX / 1500));

    if (currentX > 0 && bgWater && bgSnooze) {
        bgWater.style.opacity = '1';
        bgSnooze.style.opacity = '0';
    } else if (currentX < 0 && bgWater && bgSnooze) {
        bgWater.style.opacity = '0';
        bgSnooze.style.opacity = '1';
    }

    swipingCard.style.transform = `translate3d(${currentX}px, 0, 0) scale(${scale})`;
    requestAnimationFrame(swipeLoop);
}

plantListEl.addEventListener('touchstart', e => {
    const card = e.target.closest('.card-foreground');
    if (!card) return;
    
    wasSwiped = false;
    isSwiping = true;
    isVerticalScroll = false;
    swipingCard = card;
    
    bgWater = swipingCard.parentElement.querySelector('.bg-water');
    bgSnooze = swipingCard.parentElement.querySelector('.bg-snooze');
    
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    rawX = 0;
    currentX = 0;
    
    card.style.transition = 'none'; 
    requestAnimationFrame(swipeLoop);
}, { passive: true });

plantListEl.addEventListener('touchmove', e => {
    if (!swipingCard) return;
    
    if (!wasSwiped && !isVerticalScroll) {
        const deltaX = Math.abs(e.touches[0].clientX - startX);
        const deltaY = Math.abs(e.touches[0].clientY - startY);
        
        if (deltaY > deltaX && deltaY > 5) {
            isVerticalScroll = true;
            isSwiping = false;
            swipingCard.style.transform = `translate3d(0, 0, 0) scale(1)`;
            swipingCard = null;
            return;
        } else if (deltaX > 5) {
            wasSwiped = true;
        }
    }
    
    if (isVerticalScroll) return;
    
    rawX = e.touches[0].clientX - startX;
    
    if (wasSwiped && e.cancelable) {
        e.preventDefault();
    }
}, { passive: false });

plantListEl.addEventListener('touchend', e => {
    if (!swipingCard || isVerticalScroll) return;
    
    isSwiping = false; 
    const cardForeground = swipingCard;
    const plantId = Number(cardForeground.closest('.plant-card').getAttribute('data-id'));
    const SWIPE_THRESHOLD = 75;
    
    cardForeground.style.transition = 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)';
    
    if (currentX > SWIPE_THRESHOLD) {
        cardForeground.style.transform = `translate3d(0, 0, 0) scale(1)`;
        cardForeground.classList.add('watered-pulse');
        
        setTimeout(() => {
            if (bgWater) bgWater.style.opacity = '0';
            if (bgSnooze) bgSnooze.style.opacity = '0';
        }, 150);
        
        setTimeout(() => handleWater(plantId), 400); 
        
    } else if (currentX < -SWIPE_THRESHOLD) {
        cardForeground.style.transform = `translate3d(0, 0, 0) scale(1)`; 
        cardForeground.classList.add('snoozed-pulse'); 
        
        setTimeout(() => {
            if (bgWater) bgWater.style.opacity = '0';
            if (bgSnooze) bgSnooze.style.opacity = '0';
        }, 150);
        
        setTimeout(() => handleSnooze(plantId), 400);
        
    } else {
        cardForeground.style.transform = `translate3d(0, 0, 0) scale(1)`;
        setTimeout(() => {
            if (bgWater) bgWater.style.opacity = '0';
            if (bgSnooze) bgSnooze.style.opacity = '0';
        }, 300);
    }
    
    swipingCard = null;
    bgWater = null;
    bgSnooze = null;
});

plantListEl.addEventListener('click', e => {
    if (wasSwiped) return; 
    const card = e.target.closest('.card-foreground');
    if (!card) return;
    const plantId = Number(card.closest('.plant-card').getAttribute('data-id'));
    openProfileModal(plantId);
});

// Edit & Delete Handlers
cancelEditBtn.addEventListener('click', () => {
    editModal.classList.remove('show');
    setTimeout(() => editForm.reset(), 300);
});

editForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = Number(document.getElementById('edit-plant-id').value);
    
    const plantIndex = localPlants.findIndex(p => p.id === id);
    const plant = localPlants[plantIndex];
    const oldState = JSON.parse(JSON.stringify(plant)); 
    
    plant.name = document.getElementById('edit-plant-name').value;
    plant.species = document.getElementById('edit-plant-species').value;
    plant.interval = parseInt(document.getElementById('edit-water-interval').value, 10);
    plant.summerFertilizer = parseInt(document.getElementById('edit-summer-fert').value, 10) || 0;
    plant.winterFertilizer = parseInt(document.getElementById('edit-winter-fert').value, 10) || 0;
    
    if (!plant.lastFertilized && (plant.summerFertilizer > 0 || plant.winterFertilizer > 0)) {
        plant.lastFertilized = Date.now();
        plant.fertilizerHistory = [Date.now()];
    }

    const fileInput = document.getElementById('edit-plant-photo');
    if (fileInput.files.length > 0) {
        plant.photo = await compressImage(fileInput.files[0]);
    } else if (pendingPhotoRemoval) {
        plant.photo = null;
    }

    syncLocalCache();
    renderPlants(); 
    editModal.classList.remove('show');
    
    showToast('Plant updated successfully.', () => {
        localPlants[plantIndex] = oldState;
        syncLocalCache();
        renderPlants();
        savePlant(oldState);
        showToast('Edits undone.');
    });
    
    savePlant(plant).catch(err => console.error(err));
});

deleteBtn.addEventListener('click', () => {
    const id = Number(document.getElementById('edit-plant-id').value);
    const plantIndex = localPlants.findIndex(p => p.id === id);
    const plant = localPlants[plantIndex];
    
    if(confirm(`Are you sure you want to delete ${plant.name}?`)) {
        localPlants.splice(plantIndex, 1);
        syncLocalCache();
        renderPlants();
        editModal.classList.remove('show');
        
        showToast(`${plant.name} deleted.`, () => {
            localPlants.push(plant); 
            syncLocalCache();
            renderPlants();
            savePlant(plant);
            showToast('Deletion undone.');
        });
        
        deletePlantFromDB(id).catch(err => console.error(err));
    }
});

// Initialize App
initDB().catch(err => console.error(err));
