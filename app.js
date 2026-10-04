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
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function initDB() {
    return Promise.resolve(); 
}

// DB Operations
async function getAllPlants() {
    const { data, error } = await supabaseClient.from('plants').select('*').order('id', { ascending: true });
    if (error) throw error;
    return data || [];
}

async function getPlant(id) {
    const { data, error } = await supabaseClient.from('plants').select('*').eq('id', id).single();
    if (error) throw error;
    return data;
}

async function savePlant(plant) {
    if (plant.id) {
        // Update existing plant
        const { data, error } = await supabaseClient.from('plants').update(plant).eq('id', plant.id).select().single();
        if (error) throw error;
        return data;
    } else {
        // Insert new plant
        const { data, error } = await supabaseClient.from('plants').insert([plant]).select().single();
        if (error) throw error;
        return data;
    }
}

async function deletePlantFromDB(id) {
    const { error } = await supabaseClient.from('plants').delete().eq('id', id);
    if (error) throw error;
}

// DOM Elements
const plantListEl = document.getElementById('plant-list');
const addModal = document.getElementById('add-modal');
const addBtn = document.getElementById('add-btn');
const exportBtn = document.getElementById('export-btn');
const cancelAddBtn = document.getElementById('cancel-add-btn');
const addForm = document.getElementById('add-form');

// Profile DOM Elements
const profileModal = document.getElementById('profile-modal');
const closeProfileBtn = document.getElementById('close-profile-btn');
const profileEditBtn = document.getElementById('profile-edit-btn');
const profileWaterBtn = document.getElementById('profile-water-btn');
const historyContainer = document.getElementById('profile-history-container');

// Edit DOM Elements
const editModal = document.getElementById('edit-modal');
const cancelEditBtn = document.getElementById('cancel-edit-btn');
const editForm = document.getElementById('edit-form');
const deleteBtn = document.getElementById('delete-btn');

const toastEl = document.getElementById('toast');
const toastMessageEl = document.getElementById('toast-message');
const toastUndoBtn = document.getElementById('toast-undo');

const searchInput = document.getElementById('search-input');
const filterSelect = document.getElementById('filter-select');
const sortSelect = document.getElementById('sort-select');
const waterAllBtn = document.getElementById('water-all-btn');

let toastTimeout;
let activeUndoAction = null;
let currentProfilePlantId = null;

// Utilities
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/\-/g, '+')
        .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

async function ensurePermissions() {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
        try { await Notification.requestPermission(); } catch (e) { console.error(e); }
    }
    if (Notification.permission === 'granted') {
        try {
            const reg = await navigator.serviceWorker.ready;
            let subscription = await reg.pushManager.getSubscription();
            if (!subscription) {
                const publicVapidKey = 'BMLgtHvDuMMlRYahJNmrokmfy_clSvP5qgDZN_yz7tFRR5US2V82O63spXJlIVMqJ6BbT1za8-8ZV7yEtVebvGw';
                subscription = await reg.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(publicVapidKey)
                });
                await supabaseClient.from('push_subscriptions').insert([{ subscription: subscription.toJSON() }]);
            }
        } catch (error) { console.error(error); }
    }
}

async function updateAppBadgeAndNotify(plants) {
    let overdueCount = 0;
    const now = Date.now();
    plants.forEach(plant => {
        const { daysLeft } = plant.computedStatus || calculatePlantStatus(plant, now);
        if (daysLeft <= 0) overdueCount++;
    });

    if ('setAppBadge' in navigator) {
        try { overdueCount > 0 ? await navigator.setAppBadge(overdueCount) : await navigator.clearAppBadge(); } catch (e) {}
    }

    if ('Notification' in window && Notification.permission === 'granted' && overdueCount > 0) {
        const lastNotified = localStorage.getItem('lastNotifiedDate');
        const today = new Date().toDateString();
        if (lastNotified !== today) {
            navigator.serviceWorker.ready.then(reg => {
                reg.showNotification('Plants Need Water!', {
                    body: `You have ${overdueCount} plant(s) ready to be watered today.`,
                    icon: 'icon-192.png',
                    badge: 'icon-192.png'
                });
            });
            localStorage.setItem('lastNotifiedDate', today);
        }
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

exportBtn.addEventListener('click', async () => {
    try {
        const plants = await getAllPlants();
        const dataStr = JSON.stringify(plants, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `plant-tracker-backup-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('Backup downloaded securely.');
    } catch (e) {
        showToast('Failed to export data.');
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

function calculatePlantStatus(plant, now) {
    const lastWatered = plant.history && plant.history.length > 0 ? plant.history[plant.history.length - 1] : plant.lastWatered;
    const baseNextWaterDate = lastWatered + (plant.interval * MS_PER_DAY);
    const nextWaterDate = Math.max(baseNextWaterDate, plant.snoozedUntil || 0);
    const daysLeft = Math.ceil((nextWaterDate - now) / MS_PER_DAY);
    const totalIntervalDays = Math.ceil((nextWaterDate - lastWatered) / MS_PER_DAY);
    return { lastWatered, nextWaterDate, daysLeft, totalIntervalDays };
}

function renderHistoryList(historyArray) {
    historyContainer.innerHTML = '';
    if (!historyArray || historyArray.length === 0) {
        historyContainer.innerHTML = '<div class="history-item">No watering history yet.</div>';
        return;
    }
    const sortedHistory = [...historyArray].sort((a, b) => b - a);
    sortedHistory.forEach((timestamp) => {
        const date = new Date(timestamp);
        const formattedDate = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        const div = document.createElement('div');
        div.className = 'history-item';
        div.innerHTML = `<span>💧 Watered</span> <span>${formattedDate}</span>`;
        historyContainer.appendChild(div);
    });
}

// Action Handlers
async function handleWater(plantId, skipRender = false) {
    const plant = await getPlant(plantId);
    await ensurePermissions(); 
    const now = Date.now();
    const oldState = JSON.parse(JSON.stringify(plant)); 

    plant.lastWatered = now;
    if (!plant.history) plant.history = [];
    plant.history.push(now);
    plant.snoozedUntil = null; 
    
    await savePlant(plant);
    if (!skipRender) renderPlants();
    
    showToast(`${plant.name} watered!`, async () => {
        await savePlant(oldState);
        renderPlants();
        showToast('Watering undone.');
    });
}

async function handleSnooze(plantId) {
    const plant = await getPlant(plantId);
    const oldState = JSON.parse(JSON.stringify(plant)); 
    
    const lastWatered = plant.history && plant.history.length > 0 ? plant.history[plant.history.length - 1] : plant.lastWatered;
    const currentTarget = Math.max(lastWatered + (plant.interval * MS_PER_DAY), plant.snoozedUntil || 0, Date.now());
    plant.snoozedUntil = currentTarget + MS_PER_DAY;
    
    await savePlant(plant);
    renderPlants();
    
    showToast(`${plant.name} snoozed for 1 day.`, async () => {
        await savePlant(oldState);
        renderPlants();
        showToast('Snooze undone.');
    });
}

// Core Rendering
async function renderPlants() {
    plantListEl.innerHTML = '';
    const now = Date.now();
    let plants = await getAllPlants();
    
    plants = plants.map(plant => ({ ...plant, computedStatus: calculatePlantStatus(plant, now) }));
    updateAppBadgeAndNotify(plants);

    const searchTerm = searchInput.value.toLowerCase();
    if (searchTerm) plants = plants.filter(p => p.name.toLowerCase().includes(searchTerm) || (p.species && p.species.toLowerCase().includes(searchTerm)));

    const filterTerm = filterSelect.value;
    let dueCount = 0;
    
    if (filterTerm === 'due') plants = plants.filter(p => p.computedStatus.daysLeft <= 0);
    
    const allPlants = await getAllPlants();
    allPlants.forEach(p => { if (calculatePlantStatus(p, now).daysLeft <= 0) dueCount++; });

    waterAllBtn.style.display = dueCount > 0 && plants.length > 0 ? 'block' : 'none';

    const sortTerm = sortSelect.value;
    if (sortTerm === 'urgency') plants.sort((a, b) => a.computedStatus.nextWaterDate - b.computedStatus.nextWaterDate);
    else if (sortTerm === 'name') plants.sort((a, b) => a.name.localeCompare(b.name));

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
        const { daysLeft, totalIntervalDays, lastWatered } = plant.computedStatus;
        
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
                        <div class="last-watered-text">Last watered: ${lastWateredFormatted}</div>
                    </div>
                </div>
            </div>
        `;
        plantListEl.appendChild(card);
    });
}

searchInput.addEventListener('input', renderPlants);
filterSelect.addEventListener('change', renderPlants);
sortSelect.addEventListener('change', renderPlants);

waterAllBtn.addEventListener('click', async () => {
    await ensurePermissions();
    const now = Date.now();
    const plants = await getAllPlants();
    let wateredCount = 0;
    const oldPlantsState = JSON.parse(JSON.stringify(plants));

    for (let plant of plants) {
        const { daysLeft } = calculatePlantStatus(plant, now);
        if (daysLeft <= 0) {
            plant.lastWatered = now;
            if (!plant.history) plant.history = [];
            plant.history.push(now);
            plant.snoozedUntil = null;
            await savePlant(plant);
            wateredCount++;
        }
    }

    if (wateredCount > 0) {
        renderPlants();
        showToast(`Watered ${wateredCount} plant(s)!`, async () => {
            for (let oldPlant of oldPlantsState) await savePlant(oldPlant);
            renderPlants();
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
    await ensurePermissions(); 

    const fileInput = document.getElementById('plant-photo');
    let photoDataUrl = null;
    if (fileInput.files.length > 0) photoDataUrl = await compressImage(fileInput.files[0]);

    const name = document.getElementById('plant-name').value;
    const species = document.getElementById('plant-species').value;
    const interval = parseInt(document.getElementById('water-interval').value, 10);
    const now = Date.now();
    
    await savePlant({
        name, species, interval, lastWatered: now, history: [now], snoozedUntil: null, photo: photoDataUrl
    });

    renderPlants();
    addModal.classList.remove('show');
    setTimeout(() => addForm.reset(), 300);
    showToast(`${name} added!`);
});

// Profile View Logic
async function openProfileModal(plantId) {
    const plant = await getPlant(plantId);
    if (!plant) return;
    
    currentProfilePlantId = plantId;
    const { daysLeft } = calculatePlantStatus(plant, Date.now());

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

    const headerImg = document.getElementById('profile-header-img');
    const placeholder = document.getElementById('profile-placeholder-emoji');
    if (plant.photo) {
        headerImg.style.backgroundImage = `url(${plant.photo})`;
        placeholder.style.display = 'none';
    } else {
        headerImg.style.backgroundImage = 'none';
        placeholder.style.display = 'block';
    }

    renderHistoryList(plant.history || [plant.lastWatered]);
    profileModal.classList.add('show');
}

closeProfileBtn.addEventListener('click', () => {
    profileModal.classList.remove('show');
    currentProfilePlantId = null;
});

profileWaterBtn.addEventListener('click', async () => {
    if (!currentProfilePlantId) return;
    await handleWater(currentProfilePlantId, true);
    
    // Refresh modal data instantly
    openProfileModal(currentProfilePlantId); 
    renderPlants();
});

// Open Edit Modal from Profile
profileEditBtn.addEventListener('click', async () => {
    if (!currentProfilePlantId) return;
    const plant = await getPlant(currentProfilePlantId);
    
    document.getElementById('edit-plant-id').value = plant.id;
    document.getElementById('edit-plant-name').value = plant.name;
    document.getElementById('edit-plant-species').value = plant.species || '';
    document.getElementById('edit-water-interval').value = plant.interval;
    
    const preview = document.getElementById('edit-photo-preview');
    if (plant.photo) {
        preview.src = plant.photo;
        preview.style.display = 'block';
    } else {
        preview.style.display = 'none';
    }

    profileModal.classList.remove('show');
    editModal.classList.add('show');
});


// Tap vs Swipe Gesture Logic
let startX = 0;
let currentX = 0;
let swipingCard = null;
let wasSwiped = false; // Flag to prevent tap if we swiped

plantListEl.addEventListener('touchstart', e => {
    const card = e.target.closest('.card-foreground');
    if (!card) return;
    
    wasSwiped = false;
    swipingCard = card;
    startX = e.touches[0].clientX;
    card.style.transition = 'none'; 
}, { passive: true });

plantListEl.addEventListener('touchmove', e => {
    if (!swipingCard) return;
    currentX = e.touches[0].clientX - startX;
    
    if (Math.abs(currentX) > 10) wasSwiped = true;
    
    if (currentX > 120) currentX = 120 + (currentX - 120) * 0.2;
    if (currentX < -120) currentX = -120 + (currentX + 120) * 0.2;
    
    swipingCard.style.transform = `translateX(${currentX}px)`;
}, { passive: true });

plantListEl.addEventListener('touchend', e => {
    if (!swipingCard) return;
    
    const cardForeground = swipingCard;
    const plantId = Number(cardForeground.closest('.plant-card').getAttribute('data-id'));
    const SWIPE_THRESHOLD = 75;
    
    cardForeground.style.transition = 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
    
    if (currentX > SWIPE_THRESHOLD) {
        cardForeground.style.transform = `translateX(120%)`;
        setTimeout(() => handleWater(plantId), 250);
    } else if (currentX < -SWIPE_THRESHOLD) {
        cardForeground.style.transform = `translateX(-120%)`;
        setTimeout(() => handleSnooze(plantId), 250);
    } else {
        cardForeground.style.transform = `translateX(0)`;
    }
    
    swipingCard = null;
    currentX = 0;
});

// Click Listener for Tap-to-View Profile
plantListEl.addEventListener('click', e => {
    // If the user was dragging the card, prevent the tap event
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
    const plant = await getPlant(id);
    const oldState = JSON.parse(JSON.stringify(plant)); 
    
    plant.name = document.getElementById('edit-plant-name').value;
    plant.species = document.getElementById('edit-plant-species').value;
    plant.interval = parseInt(document.getElementById('edit-water-interval').value, 10);
    
    const fileInput = document.getElementById('edit-plant-photo');
    if (fileInput.files.length > 0) plant.photo = await compressImage(fileInput.files[0]);

    await savePlant(plant);
    renderPlants();
    editModal.classList.remove('show');
    
    showToast('Plant updated successfully.', async () => {
        await savePlant(oldState);
        renderPlants();
        showToast('Edits undone.');
    });
});

deleteBtn.addEventListener('click', async () => {
    const id = Number(document.getElementById('edit-plant-id').value);
    const plant = await getPlant(id);
    
    if(confirm(`Are you sure you want to delete ${plant.name}?`)) {
        await deletePlantFromDB(id);
        renderPlants();
        editModal.classList.remove('show');
        
        showToast(`${plant.name} deleted.`, async () => {
            await savePlant(plant); 
            renderPlants();
            showToast('Deletion undone.');
        });
    }
});

// Initialize
initDB().then(() => renderPlants()).catch(err => console.error(err));
