const CACHE_NAME = 'plant-tracker-v2';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './manifest.json'
];

self.addEventListener('install', event => {
    event.waitUntil( 
        caches.open(CACHE_NAME).then(cache => {
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cache => {
                    if (cache !== CACHE_NAME) {
                        return caches.delete(cache);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// Stale-while-revalidate strategy
self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;
    
    event.respondWith(
        caches.match(event.request).then(cachedResponse => {
            const fetchPromise = fetch(event.request).then(networkResponse => {
                if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, networkResponse.clone());
                    });
                }
                return networkResponse;
            }).catch(() => {
                // Ignore fetch errors if offline
            });
            
            return cachedResponse || fetchPromise;
        })
    );
});

self.addEventListener('push', event => {
    let payload = { title: 'Plant Tracker', body: 'Time to check your plants!' };
    
    // Extract data from the server payload if available
    if (event.data) {
        try {
            payload = event.data.json(); // If Supabase sends a JSON payload
        } catch (e) {
            payload.body = event.data.text(); // Fallback to plain text
        }
    }

    const options = {
        body: payload.body,
        icon: './icon-192.png',
        badge: './icon-192.png'
    };

    // CRITICAL FOR iOS: You must wrap showNotification in event.waitUntil()
    event.waitUntil(
        self.registration.showNotification(payload.title || 'Plant Tracker', options)
    );
});

self.addEventListener('notificationclick', event => {
    // Close the notification immediately when tapped
    event.notification.close();

    // This forces the PWA to open or come to the foreground
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
            for (let i = 0; i < clientList.length; i++) {
                const client = clientList[i];
                // If the app is already open in the background, focus it
                if (client.url === '/' && 'focus' in client) {
                    return client.focus();
                }
            }
            // If the app is completely closed, open a new instance
            if (clients.openWindow) {
                return clients.openWindow('/');
            }
        })
    );
});
