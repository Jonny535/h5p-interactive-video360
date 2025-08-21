/* ===============================================
 * WIDGET EDITOR PER L'ANTEPRIMA VIDEO E LA POSIZIONE HOTSPOT
 * @author Jonathan Casadei
 * @namespace H5PEditor.widgets
 * @class H5PEditor.widgets.video360player
 * @param {H5PEditor.Editor} parent
 * @param {object} field
 * @param {object} params
 * @param {function} setValue
 =============================================== */
H5PEditor.widgets.video360player = (function ($) {
    'use strict';

    /**
     * @constructor
     * @param {object} parent - parent object
     * @param {object} field - field definition
     * @param {object} params - parameters
     * @param {function} setValue - function to set params
     */
    function Video360Player(parent, field, params, setValue) {
        const self = this;
        H5P.EventDispatcher.call(self);

        self.parent = parent;
        self.field = field;
        self.params = params || {};
        self.setValue = setValue;

        self.player = null;
        self.$playerContainer = null;
        self.videoUrl = null;
        self.vrComponentsReady = false;
        
        // Mappa dei marker visivi (per gestione nel DOM)
        self.markers = {};

        // Inizializza l'interazione con il player
        self._init();
    }

    Video360Player.prototype = Object.create(H5P.EventDispatcher.prototype);
    Video360Player.prototype.constructor = Video360Player;

    /**
     * Inizializza il widget e si connette al campo video.
     * @private
     */
    Video360Player.prototype._init = function () {
        const self = this;
        // Trova il campo video nel parent, che può essere annidato
        const videoField = H5PEditor.findField('video', self.parent);

        if (videoField) {
            const update = () => {
                self.readFile();
                self.updatePlayer();
            };
            // Ascolta gli eventi di caricamento del video
            videoField.on('uploadComplete', update);
            videoField.on('change', update);
        }
    };

    /**
     * Aggiunge il player al DOM.
     * @param {object} $wrapper jQuery container.
     */
    Video360Player.prototype.appendTo = function ($wrapper) {
        const self = this;
        self.$playerContainer = $('<div>', {
            'class': 'h5p-video360-player-container',
            'id': 'h5p-video360-player-wrapper-' + H5P.createUUID()
        });

        $wrapper.append($('<div>', {
            'class': 'h5p-video360-player-label',
            'html': self.field.label || ''
        }));
        $wrapper.append($('<div>', {
            'class': 'h5p-video360-player-description',
            'html': self.field.description || ''
        }));
        $wrapper.append(self.$playerContainer);

        self.$playerContainer.on('click', (event) => self.handlePlayerClick(event));

        self.updatePlayer();
    };

    /**
     * Dispone il player e pulisce le risorse.
     */
    Video360Player.prototype.remove = function () {
        const self = this;
        if (self.player) {
            self.player.dispose();
            self.player = null;
        }
        if (self.$playerContainer) {
            self.$playerContainer.remove();
        }
    };

    /**
     * Recupera l'URL del video dal campo H5P.
     */
    Video360Player.prototype.readFile = function () {
        const self = this;
        const videoField = H5PEditor.findField('video', self.parent);
        const videoFiles = videoField?.params || [];
        const videoFile = videoFiles.find(f => f?.path && f.mime?.startsWith('video/'));

        if (videoFile) {
            self.videoUrl = H5P.getPath(videoFile.path, H5P.contentId);
        } else {
            self.videoUrl = null;
        }
        self.trigger('videoUrlUpdated');
    };

    /**
     * Inizializza o aggiorna il player Video.js.
     */
    Video360Player.prototype.updatePlayer = function () {
        const self = this;

        if (self.player) {
            self.player.dispose();
            self.player = null;
        }

        self.vrComponentsReady = false;
        self.$playerContainer.empty();
        self.markers = {};

        if (!self.videoUrl) {
            self.$playerContainer.html('<div class="h5p-video360-player-message">Carica un video per visualizzare l\'anteprima 360°.</div>');
            return;
        }

        const $videoElement = $('<video>', {
            'id': 'h5p-video360-video-' + H5P.createUUID(),
            'class': 'video-js vjs-default-skin vjs-big-play-centered',
            'playsinline': true,
            'preload': 'auto',
            'controls': true,
            'crossorigin': 'anonymous',
            'style': 'width: 100%; height: 100%;'
        });
        self.$playerContainer.prepend($videoElement);

        try {
            self.player = videojs($videoElement[0], {
                autoplay: false,
                inactivityTimeout: 0,
                sources: [{ src: self.videoUrl, type: 'video/mp4' }]
            });

            if (typeof self.player.vr === 'function') {
                self.player.vr({ projection: '360' });
            }

            self.bindPlayerEvents();
        } catch (e) {
            console.error('Video.js init error:', e);
            self.$playerContainer.html('<div class="h5p-video360-player-message" style="color: red;">Impossibile inizializzare il player video. Controlla la console per i dettagli.</div>');
        }
    };

    /**
     * Collega gli event listener al player.
     * @private
     */
    Video360Player.prototype.bindPlayerEvents = function () {
        const self = this;
        self.player.on('ready', () => {
            self.vrComponentsReady = true;
            self.duration = self.player.duration();
            self.loadAllHotspots();
        });

        self.player.on('timeupdate', () => {
            const currentTime = self.player.currentTime();
            self.updateAllHotspots(currentTime);
        });

        self.player.on('error', () => {
            const msg = self.player.error()?.message || 'Sconosciuto';
            self.$playerContainer.html(`<div class="h5p-video360-player-message" style="color: red;">Errore nel caricamento del video: ${msg}</div>`);
        });
    };

    /**
     * Carica tutti i marker visivi degli hotspot.
     */
    Video360Player.prototype.loadAllHotspots = function () {
        const self = this;
        if (!self.player || !self.vrComponentsReady) return;

        const hotspotWidget = H5PEditor.findField('addHotspot', self.parent);
        if (!hotspotWidget || !hotspotWidget.params || !hotspotWidget.params.hotspots) return;

        const scene = self.player.vr().scene;
        // Pulisce i marker vecchi
        Object.values(self.markers).forEach(marker => scene.remove(marker));
        self.markers = {};

        const hotspots = hotspotWidget.params.hotspots;
        hotspots.forEach(hotspot => {
            if (hotspot.hotspotType === 'static' && hotspot.positioned) {
                self.addVisualMarker({yaw: hotspot.yaw, pitch: hotspot.pitch}, hotspot.id, 'static');
            } else if (hotspot.hotspotType === 'dynamic' && hotspot.keyframes && hotspot.keyframes.length > 0) {
                hotspot.keyframes.forEach((keyframe, index) => {
                    self.addVisualMarker({
                        yaw: keyframe.yaw,
                        pitch: keyframe.pitch
                    }, hotspot.id, 'keyframe', index);
                });
            }
        });
    };

    /**
     * Aggiunge un marker visivo sulla scena THREE.js.
     * @param {object} angles Yaw and pitch in degrees.
     * @param {string} hotspotId The ID of the hotspot.
     * @param {string} type Type of marker ('static' or 'keyframe').
     * @param {number} keyframeIndex Index of the keyframe (if type is 'keyframe').
     */
    Video360Player.prototype.addVisualMarker = function (angles, hotspotId, type, keyframeIndex) {
        const self = this;
        if (!self.player || !self.vrComponentsReady) return;

        const scene = self.player.vr().scene;
        const color = type === 'static' ? 0xff0000 : 0x0000ff;
        const geometry = new THREE.SphereGeometry(16, 16, 16);
        const material = new THREE.MeshBasicMaterial({ color: color, depthTest: false, depthWrite: false });
        const mesh = new THREE.Mesh(geometry, material);

        self.setMeshPositionFromAngles(mesh, angles.yaw, angles.pitch);
        mesh.userData.hotspotId = hotspotId;
        mesh.userData.type = type;

        const meshName = type === 'static' ? `hotspot_marker_static_${hotspotId}` : `hotspot_marker_keyframe_${hotspotId}_${keyframeIndex}`;
        mesh.name = meshName;
        
        self.markers[meshName] = mesh;
        scene.add(mesh);
    };

    /**
     * Aggiorna la visibilità e la posizione di tutti gli hotspot.
     * @param {number} currentTime Tempo corrente del video in secondi.
     */
    Video360Player.prototype.updateAllHotspots = function (currentTime) {
        const self = this;
        const hotspotWidget = H5PEditor.findField('addHotspot', self.parent);
        const hotspots = hotspotWidget?.params?.hotspots || [];

        hotspots.forEach(hotspot => {
            const meshName = `hotspot_marker_static_${hotspot.id}`;
            const mesh = self.markers[meshName];
            
            if (hotspot.hotspotType === 'static') {
                if (mesh) {
                    const start = hotspot.displayStartTime ?? 0;
                    const end = hotspot.displayEndTime ?? self.player.duration();
                    mesh.visible = (currentTime >= start && currentTime <= end);
                }
            } else if (hotspot.hotspotType === 'dynamic' && hotspot.keyframes && hotspot.keyframes.length > 1) {
                // Gestione e visualizzazione dei keyframe (non l'interpolazione che è lato run)
                hotspot.keyframes.forEach((keyframe, index) => {
                    const keyframeMeshName = `hotspot_marker_keyframe_${hotspot.id}_${index}`;
                    const keyframeMesh = self.markers[keyframeMeshName];
                    if(keyframeMesh){
                        self.setMeshPositionFromAngles(keyframeMesh, keyframe.yaw, keyframe.pitch);
                        keyframeMesh.visible = true;
                    }
                });
            }
        });
    };

    /**
     * Converte yaw e pitch in una posizione 3D.
     * @param {THREE.Mesh} mesh The mesh to position.
     * @param {number} yawDeg Yaw in degrees.
     * @param {number} pitchDeg Pitch in degrees.
     */
    Video360Player.prototype.setMeshPositionFromAngles = function (mesh, yawDeg, pitchDeg) {
        const yawRad = yawDeg * (Math.PI / 180);
        const pitchRad = pitchDeg * (Math.PI / 180);
        const distance = 500;
        mesh.position.set(
            distance * Math.sin(yawRad) * Math.cos(pitchRad),
            distance * Math.sin(pitchRad),
            distance * Math.cos(yawRad) * Math.cos(pitchRad)
        );
    };

    /**
     * Gestisce il click sul player per il posizionamento degli hotspot.
     * @param {Event} event Click event.
     */
    Video360Player.prototype.handlePlayerClick = function (event) {
        const self = this;
        if (!self.player || !self.vrComponentsReady) return;

        const playerRect = self.$playerContainer[0].getBoundingClientRect();
        const mouse = new THREE.Vector2();
        mouse.x = ((event.clientX - playerRect.left) / playerRect.width) * 2 - 1;
        mouse.y = -((event.clientY - playerRect.top) / playerRect.height) * 2 + 1;
        
        const camera = self.player.vr().camera;
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, camera);

        const direction = raycaster.ray.direction.clone().normalize();
        const yaw = Math.atan2(direction.x, direction.z) * (180 / Math.PI);
        const pitch = Math.atan2(direction.y, Math.sqrt(direction.x ** 2 + direction.z ** 2)) * (180 / Math.PI);

        // Invia i dati al widget genitore per il salvataggio
        self.parent.trigger('hotspot-position-changed', {
            yaw: yaw,
            pitch: pitch,
            time: self.player.currentTime()
        });

        // Aggiorna la visualizzazione del marker
        const activeHotspotId = self.parent.children.find(c => c.field.name === 'addHotspot')?.params?.activeHotspotId;
        const hotspotWidget = H5PEditor.findField('addHotspot', self.parent);
        const hotspot = hotspotWidget?.params?.hotspots.find(h => h.id === activeHotspotId);

        if (hotspot) {
            if (hotspot.hotspotType === 'static') {
                self.addVisualMarker({ yaw: yaw, pitch: pitch }, activeHotspotId, 'static');
            } else if (hotspot.hotspotType === 'dynamic') {
                // Logica per gestire i keyframe
                // Il widget hotspoticon gestirà la logica di quale keyframe aggiungere/aggiornare
            }
        }
    };
    
    /**
     * Validazione del widget.
     * @returns {boolean} True se il form è valido.
     */
    Video360Player.prototype.validate = function () {
        return true;
    };

    return Video360Player;
})(H5P.jQuery);