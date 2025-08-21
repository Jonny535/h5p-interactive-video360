
/* ===============================================
 * HOTSPOT ICON WIDGET
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
    self.duration = 0;
    self.isPlacingHotspot = false;
    self.activeHotspotID = -1;
    self.activeKeyframeIndex = -1;
    self.vrComponentsReady = false;
    self.videoStarted = false;
    self.dynamicHotspots = {};
    self.dynamicTimeHandlers = {};
    self.lastInterpolationKeyframesMap = {};

    // self._anchorTrackers = {};
    // Global access to THREE.js
    if (typeof THREE !== undefined) window.THREE = THREE;

    self._init();
  }

  Video360Player.prototype = Object.create(H5P.EventDispatcher.prototype);
  Video360Player.prototype.constructor = Video360Player;

  /**
   * Initializes the widget and sets up event listeners.
   * @private
   */
  Video360Player.prototype._init = function () {
    const self = this;
    // Find video
    self.video = H5PEditor.findField(['videoSettings', 'video'], self.parent?.parent || self.parent);

    if (self.video) {
      const update = () => { 
        self.readFile(); 
        self.updatePlayer(); 
      };
      // Listeners
      self.video.on('uploadComplete', update);
      self.video.on('change', update);
    }
  }

    /**
   * AppendTo DOM
   * @param {object} $wrapper jQuery container
   */
  Video360Player.prototype.appendTo = function ($wrapper) {
    const self = this;
    // Container
    self.$playerContainer = $('<div>', {
      'class': 'h5p-video360-player-container', 
      'id': 'h5p-video360-player-wrapper-' + H5P.createUUID()
    });
    // Label & description
    $wrapper.append($('<div>', {
      'class': 'h5p-video360-player-label',
      'html': self.field.label || ''
    }));
    $wrapper.append($('<div>', {
      'class': 'h5p-video360-player-description',
      'html': self.field.description || ''
    }));
    $wrapper.append(self.$playerContainer);

    self.$playerContainer.on('click',(event) => self.handlePlayerClick(event));
    self.updatePlayer(); // Init Player when ready
  }

  /**
   * Dispose player
   */
  Video360Player.prototype.remove = function () {
    const self = this;
  
    if (self.player) {
      self.player.off('timeupdate', self.visibilityHandler);
      Object.values(self.dynamicTimeHandlers).forEach(k => {
        self.player.off('timeupdate', self.dynamicTimeHandlers[k]);
      });
      self.player.dispose();
      self.player = null;
    }

    if (self.$playerContainer) self.$playerContainer.remove();
  }

  /**
   * Recover URL local of the video
   */  
  Video360Player.prototype.readFile = function () {
    const self = this;
    const vp = Array.isArray(self.video?.params) ? self.video.params : [];
    const videoFile = vp.find(f => f?.path && f.mime?.startsWith('video/'));

    if (videoFile) {
      const currentContentId = H5P.contentId || 0; // Fallback for contentID if undefined
      self.videoUrl = H5P.getPath(videoFile.path, currentContentId);
    } else {
      self.videoUrl = null;
    }
    self.trigger('videoUrlUpdated');
  }

  /**
   * Update video player + Listeners
   */
  Video360Player.prototype.updatePlayer = function () {
    const self = this;
    const currentVideoUrl = self.video?.params?.path || self.videoUrl;

    // Cleaning previous player
    if (self.player) {
      self.player.dispose();
      self.player = null;
    }

    // Reset flags/player/listeners
    self.vrComponentsReady = false;
    self.videoStarted = false;
    self.dynamicHotspots = {};
    self.$playerContainer.empty();

    if (!currentVideoUrl) {
      self.$playerContainer.html('<div class="h5p-video360-player-message">Carica un video per visualizzare l\'anteprima 360°.</div>');
      return;
    }

    // Init player element
    const $videoElement = $('<video>', {
      'id': 'h5p-video360-video-' + H5P.createUUID(),
      'class': 'video-js vjs-default-skin vjs-big-play-centered',
      'playsinline': true, // important: mobile
      'preload': 'auto',
      'controls': true,
      'crossorigin': 'anonymous', // Video 360 & WebGL
      'style': 'width: 100%; height: 100%;'
    });
    self.$playerContainer.prepend($videoElement);
    // Init player videojs
    try {
      self.player = videojs($videoElement[0], {
        autoplay: false,
        loop: true,
        inactivityTimeout: 0,
        sources: [{src: currentVideoUrl, type: 'video/mp4'}]
      });
      // Plugin videojs-vr
      if (typeof self.player.vr === 'function') {
          self.player.vr({projection: '360'});
      }

      // Listerners
      self.bindPlayerEvents();
    } catch (e) {
      self.$playerContainer.html('<div class="h5p-video360-player-message" style="color: red;">Impossibile inizializzare il player video. Controlla la console per i dettagli.</div>');
    }
  }

  /**
   * Binds event listeners to the player
   * @private
   */
  Video360Player.prototype.bindPlayerEvents = function () {
    const self = this;

    self.player.on('ready', function () {
      self.vrComponentsReady = true;
      self.duration = self.player.duration();
      self.bindVisibilityHandler();
    });

    self.player.on('frameupdate', () => {
      const vr = typeof self.player.vr === 'function' ? self.player.vr() : null;
      if (!vr || !vr.scene) return;

      vr.scene.traverse(obj => {
        if (obj.userData?.yaw !== undefined && obj.userData?.pitch !== undefined) {
          // Ricalcola posizione 3D dal yaw/pitch salvati
          const yawRad = obj.userData.yaw * (Math.PI / 180);
          const pitchRad = obj.userData.pitch * (Math.PI / 180);
          const distance = 500;
          obj.position.set(
            distance * Math.sin(yawRad) * Math.cos(pitchRad),
            distance * Math.sin(pitchRad),
            distance * Math.cos(yawRad) * Math.cos(pitchRad)
          );
        }
      });
    })

    self.player.on('play', function() {
      if (self.isPlacingHotspot) {
        self.player.pause();
        self.player.controls(false);
        return;
      }
      if (!self.videoStarted) self.videoStarted = true;
      self.trigger('play');
    });

    self.player.on('error', function(error) {
      const msg = self.player.error()?.message ||'Sconosciuto';
      self.$playerContainer.html(`<div class="h5p-video360-player-message" style="color: red;">Errore nel caricamento del video: ${msg}</div>`);
    });
  }

  /**
   * Updates the visibility of static hotspots
   */
  Video360Player.prototype.updateStaticHotspotsVisibility = function () {
    const self = this;

    if (!self.player?.vr?.() || !self.vrComponentsReady) return;

    const scene = self.player.vr().scene;
    if (!scene) return;

    scene.traverse(obj => {
      if (obj.userData?.type === 'static') {
        const currentTime = self.player.currentTime() ?? 0;
        const start = obj.userData.startTime ?? 0;
        const end = obj.userData.endTime ?? 0;
        obj.visible = currentTime >= start && (end <= 0 || currentTime <= end);
      }
    });
  };

  /**
   * Binds the visibility handler to the timeupdate event
   */
  Video360Player.prototype.bindVisibilityHandler = function () {
    const self = this;
    self.player.off('timeupdate', self.visibilityHandler);
    self.visibilityHandler = () => self.updateStaticHotspotsVisibility();
    self.player.on('timeupdate', self.visibilityHandler);
  };
  
  /**
   * Handle mouse click on the player
   * @param {Event} event - Clic event
   */
  Video360Player.prototype.handlePlayerClick = function (event) {
    const self = this;
    if (!self.isPlacingHotspot || !self.player || !self.vrComponentsReady) return; // Not in placement mode or player not ready

    // Bounding box container
    const playerRect = self.$playerContainer[0].getBoundingClientRect();
    // Mouse position in normalized coords
    const mouse = new THREE.Vector2();
    mouse.x = ((event.clientX - playerRect.left) / playerRect.width) * 2 - 1;
    mouse.y = -((event.clientY - playerRect.top) / playerRect.height) * 2 + 1;
    // Camera & Raycaster
    const camera = self.player.vr().camera;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);
    // Virtual Sphere
    const direction = raycaster.ray.direction.clone().normalize();
    const distance = 500;
    const intersectionPoint = direction.multiplyScalar(distance);
    // Yaw e Pitch
    const yaw = Math.atan2(intersectionPoint.x, intersectionPoint.z) * (180 / Math.PI);
    const pitch = Math.atan2(intersectionPoint.y, Math.sqrt(intersectionPoint.x ** 2 + intersectionPoint.z ** 2)) * (180 / Math.PI);
    
    // Trigger hotspoticon.handleHotspotPlacement for UI notify
    self.trigger('hotspotInserted', {
      id: self.activeHotspotID,
      keyframeIndex: self.activeKeyframeIndex,
      yaw: yaw,
      pitch: pitch,
    });

    // Handle for player
    const hotspotWidget = self.parent.children.find(c => c.field.name === 'addHotspot');
    const hotspotList = hotspotWidget?.params?.hotspots;
    const hotspot = hotspotList?.find(h => h.id === self.activeHotspotID);
    if (!hotspot) {
      self.endHotspotPlacement();
      return;
    }
    
    // Visual marker: STATIC VS DYNAMIC
    if (hotspot.hotspotType === 'static') {
      self.handleStaticHotspotPlacement(intersectionPoint, hotspot);
    } else if (hotspot.hotspotType === 'dynamic') {
      self.handleDynamicHotspotPlacement(intersectionPoint, hotspot);
    }

    // Reset state
    self.endHotspotPlacement();
  }

  /**
   * Start placement mode
   * @param {string} id Hotspot ID
   * @param {number} keyframeIndex Keyframe Index (optional)
   */
  Video360Player.prototype.startHotspotPlacement = function (id, keyframeIndex) {
    const self = this;
    if (!self.player || !self.vrComponentsReady) return;

    self.isPlacingHotspot = true;
    self.activeHotspotID = id;
    self.activeKeyframeIndex = (typeof keyframeIndex !== 'undefined') ? keyframeIndex : null;
    self.$playerContainer.addClass('h5p-video360-placement-mode');

    self.player.pause();
    self.player.controls(false);
  }

  /**
   * End placement mode
   */
  Video360Player.prototype.endHotspotPlacement = function () {
    const self = this;
    self.isPlacingHotspot = false;
    self.$playerContainer.removeClass('h5p-video360-placement-mode');
    self.player.controls(true);
    self.activeHotspotID = self.activeHotspotID === -1 ? -1 : null;
    self.activeKeyframeIndex = self.activeKeyframeIndex == -1 ? -1 : null;
  }

  /* -------------- UTILITY -------------- */
  Video360Player.prototype.formatSecondsToMSS = function (totalSeconds) {
    if (!Number.isFinite(totalSeconds)) return '';
    const total = Math.floor(totalSeconds);
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  }

  Video360Player.prototype.parseMSSToSeconds = function (mss) {
    if (mss === null || (typeof mss === 'string' && mss.trim() === '')) return null;
    if (Number.isFinite(mss)) return mss >= 0 ? Math.floor(mss) : null;

    const s = `${mss}`.trim();
    // Only seconds
    if (/^\d+$/.test(s)) {
      const secs = parseInt(s, 10);
      return secs >= 0 ? secs : null;
    }
    // Format MM::SS
    const match = s.match(/^(\d+):([0-5]\d)$/);
    if (!match) return null;

    const minutes = parseInt(match[1], 10);
    const seconds = parseInt(match[2], 10);
    return (minutes >= 0 && seconds >= 0) ? minutes * 60 + seconds : null;
  }

  /**
   * Handle marker for a static hotspot
   * @param {THREE.Vector3} intersectionPoint Intersection point clicked
   * @param {object} hotspot Static hotspot
   */
  Video360Player.prototype.handleStaticHotspotPlacement = function (intersectionPoint, hotspot) {
    const self = this;
    if (!intersectionPoint || !hotspot || !self.player) return;

    const vr = (typeof self.player.vr === 'function') ? self.player.vr() : null;
    // Remove previous marker
    self.removeMarker(self.activeHotspotID);

    const yaw = Math.atan2(intersectionPoint.x, intersectionPoint.z) * (180 / Math.PI);
    const pitch = Math.atan2(intersectionPoint.y, Math.sqrt(intersectionPoint.x ** 2 + intersectionPoint.z ** 2)) * (180 / Math.PI);

    self.addVisualMarker(intersectionPoint, vr.scene, {
      startTime: self.parseMSSToSeconds(hotspot.displayStartTime) ?? 0,
      endTime: self.parseMSSToSeconds(hotspot.displayEndTime) ?? 0,
      insertionTime: self.player.currentTime() ?? 0,
      hotspotId: hotspot.id,
      color: 0xff0000,
      yaw,
      pitch
    });
    //self.startAnchorTracking(hotspot.id, yaw, pitch);
  }

  /**
   * Handle marker for a keyframe of a dynamic hotspot
   * @param {THREE.Vector3} intersectionPoint Intersection point clicked
   * @param {object} hotspot Dynamic hotspot
   */
  Video360Player.prototype.handleDynamicHotspotPlacement = function (intersectionPoint, hotspot) {
    const self = this;
    if (!intersectionPoint || !hotspot || !self.player) return;

    const vr = (typeof self.player.vr === 'function') ? self.player.vr() : null;
    // Remove marker if repositioning
    const idx = self.activeKeyframeIndex;
    if (Array.isArray(hotspot.keyframes) && Number.isInteger(idx) && idx >= 0 && idx < hotspot.keyframes.length) {
      self.removeKeyframeMarker(self.activeHotspotID, idx);
    }

    self.addKeyframeMarker(intersectionPoint, vr.scene, {
      id: self.activeHotspotID,
      keyframeIndex: idx,
      insertionTime: self.player.currentTime() ?? 0,
      color: 0x0000ff
    });
  }

  /**
   * Add visive marker in the scene
   * @param {THREE.Vector3} position 3D position of the marker
   * @param {THREE.Scene} scene The Three scene
   * @param {object} meta Marker data
   * @returns {THREE.Mesh|null} Marker mesh or null
   */
  Video360Player.prototype.addVisualMarker = function (position, scene, meta = {}) {
    if (!scene || !position) return null;

    // Dot on the video
    const color = (meta.color !== undefined) ? meta.color : 0xff0000;
    const geometry = new THREE.SphereGeometry(16, 16, 16);
    const material = new THREE.MeshBasicMaterial({color: color, depthTest: false, depthWrite: false });
    const mesh = new THREE.Mesh(geometry, material);
    // Sphere local position
    mesh.position.copy(position);
    mesh.name = `hotspot_marker_${meta.hotspotId}`;

    mesh.userData = {
      type: 'static',
      hotspotId: meta.hotspotId,
      startTime: meta.startTime,
      endTime: meta.endTime,
      insertionTime: meta.insertionTime,
      yaw: meta.yaw,
      pitch: meta.pitch 
    };

    scene.add(mesh);
    return mesh;
  }

  /**
   * Add visive marker for keyframe
   * @param {THREE.Vector3} position 3D position of the marker
   * @param {THREE.Scene} scene The Three scene
   * @param {object} meta Marker data
   * @returns {THREE.Mesh|null} Marker mesh or null
   */
  Video360Player.prototype.addKeyframeMarker = function (position, scene, meta = {}) {
    if (!scene || !position) return null;
    console.log(scene)

    const color = (meta.color !== undefined) ? meta.color : 0x0000ff;
    const geometry = new THREE.SphereGeometry(16, 16, 16);
    const material = new THREE.MeshBasicMaterial({color: color, depthTest: false, depthWrite: false});
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    mesh.name = `hotspot_marker_keyframe_${meta.id}_${meta.keyframeIndex}`;

    mesh.userData = {
      type: 'keyframe',
      id: meta.id,
      keyframeIndex: meta.keyframeIndex,
      time: meta.time,
      insertionTime: meta.insertionTime
    };

    scene.add(mesh);
    return mesh;
  }

  /**
   * Remove static marker
   * @param {string} id Marker ID
   */
  Video360Player.prototype.removeMarker = function (id) {
    const self = this;
    const scene = self.player.vr().scene;
    if (!scene) return;
    const marker = `hotspot_marker_${id}`;
    const existing = scene.getObjectByName(marker);
    if (existing) scene.remove(existing);
    // self.stopAnchorTracking(id);
  }

  /**
   * Remove keyframe marker
   * @param {string} id Hotspot ID
   * @param {number} keyframeIndex Keyframe index to remove
   */
  Video360Player.prototype.removeKeyframeMarker = function (id, keyframeIndex) {
    const self = this;
    const scene = self.player.vr().scene;
    if (!scene || !Number.isInteger(keyframeIndex) || keyframeIndex < 0) return;
    const marker = `hotspot_marker_keyframe_${id}_${keyframeIndex}`;
    const existing = scene.getObjectByName(marker);
    if (existing) scene.remove(existing);
  }

  /**
   * Compute and display dynamic position of hotspot by interpolation
   * @param {string} id Hotspot ID
   * @param {array} keyframes L'array di keyframe.
   */
  Video360Player.prototype.interpolateHotspot = function (hotspotId, keyframes) {
    const self = this;
    if (!self.player || !self.vrComponentsReady || keyframes.length < 2) return;
    // Sort and filter
    const scene = self.player.vr().scene;
    const sortedKeyframes = keyframes
      .map(k => ({ 
        time: Number(k.time), 
        yaw: Number(k.yaw), 
        pitch: Number(k.pitch)
      }))
      .filter(k => !isNaN(k.time) && !isNaN(k.yaw) && !isNaN(k.pitch))
      .sort((a, b) => a.time - b.time);
    // Save map keyframes for Hotspot ID
    self.lastInterpolationKeyframesMap[hotspotId] = sortedKeyframes;
    // Cleanup
    if (self.dynamicHotspots[hotspotId]) {
      scene.remove(self.dynamicHotspots[hotspotId]);
    }
    if (self.dynamicTimeHandlers[hotspotId]) {
      self.player.off('timeupdate', self.dynamicTimeHandlers[hotspotId]);
    }

    // Create Dynamic mesh
    const geometry = new THREE.SphereGeometry(16, 16, 16);
    const material = new THREE.MeshBasicMaterial({color: 0x00ff00, depthTest: false, depthWrite: false });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `hotspot_marker_${hotspotId}`;
    scene.add(mesh);
    self.dynamicHotspots[hotspotId] = mesh;
    // Initial position 
    self.setMeshPositionFromAngles(mesh, sortedKeyframes[0].yaw, sortedKeyframes[0].pitch);

    // Handler
    const handler = function () {
      const currentTime = self.player.currentTime();
      const FKTime = sortedKeyframes[0].time;
      const LKTime = sortedKeyframes[sortedKeyframes.length - 1].time;
      
      const espilon = 0.01;
      if (currentTime < FKTime - espilon || currentTime > LKTime + espilon) {
        mesh.visible = false;
        return;
      }

      // Find interval
      let fKey = sortedKeyframes[0];
      let sKey = sortedKeyframes[sortedKeyframes.length - 1];
      for (let i = 0; i < sortedKeyframes.length - 1; i++) {
        if (currentTime >= sortedKeyframes[i].time && currentTime <= sortedKeyframes[i + 1].time) {
          fKey = sortedKeyframes[i];
          sKey = sortedKeyframes[i + 1];
          break;
        }
      }

      const timeDiff = sKey.time - fKey.time;
      const t = timeDiff > 0 ? (currentTime - fKey.time) / timeDiff : 0;
      const yaw = self.interpolateAngle(fKey.yaw, sKey.yaw, t);
      const pitch = fKey.pitch + (sKey.pitch - fKey.pitch) * t;

      self.setMeshPositionFromAngles(mesh, yaw, pitch);
      mesh.visible = true;
    };

    self.dynamicTimeHandlers[hotspotId] = handler;
    self.player.on('timeupdate', handler);
    for (let i = 0; i < keyframes.length; i++) {
      self.removeKeyframeMarker(hotspotId, i);
    }
  }

  /**
   * 
   * @param {*} mesh 
   * @param {*} yawDeg 
   * @param {*} pitchDeg 
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
   * Helper function to interpolate the angles considering wrap-around
   * @param {*} a1 
   * @param {*} a2 
   * @param {*} t 
   * @returns 
   */
  Video360Player.prototype.interpolateAngle = function (a1, a2, t) {
    let delta = a2 - a1;
    if (Math.abs(delta) > 180) delta = delta > 0 ? delta -360 : delta + 360;
    return a1 + delta * t;
  }

  /**
   * Validation of the widget
   * @returns {boolean}
   */
  Video360Player.prototype.validate = function () {
    return true;
  }

  /*Video360Player.prototype.startAnchorTracking = async function (hotspotId, yawDeg, pitchDeg) {
    const self = this;
    if (!self.player?.vr?.() || !self.vrComponentsReady) return;

    const videoEl = self.$playerContainer.find('video')[0];
    const W = videoEl.videoWidth, H = videoEl.videoHeight;
    if (!W || !H) return;

    // Crea tracker se non esiste
    const key = String(hotspotId);
    if (self._anchorTrackers[key]) self.stopAnchorTracking(key);

    // bbox iniziale attorno al punto selezionato (48x48 di default)
    const px = yawPitchToPixel(yawDeg, pitchDeg, W, H);
    const initBox = { x: px.x - 24, y: px.y - 24, w: 48, h: 48 };

    const tracker = new AnchorTrackerTFJS();
    await tracker.initFromVideo(videoEl, initBox);

    // recupera mesh
    const meshName = `hotspot_marker_${hotspotId}`;
    const mesh = self.player.vr().scene.getObjectByName(meshName);

    const tick = async () => {
      if (!self._anchorTrackers[key]) return; // stoppato
      const prior = self._anchorTrackers[key].lastBox || initBox;
      const { box, score } = await tracker.update(prior);

      // Aggiorna posizione mesh
      const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
      const ang = pixelToYawPitch(cx, cy, W, H);
      if (mesh) {
        self.setMeshPositionFromAngles(mesh, ang.yawDeg, ang.pitchDeg);
        mesh.userData.yaw = ang.yawDeg;
        mesh.userData.pitch = ang.pitchDeg;
      }
      self._anchorTrackers[key].lastBox = box;

      self._anchorTrackers[key].rafId = requestAnimationFrame(tick);
    };

    self._anchorTrackers[key] = { tracker, rafId: requestAnimationFrame(tick), lastBox: initBox, meshName };
  };

  Video360Player.prototype.stopAnchorTracking = function (hotspotId) {
    const self = this;
    const key = String(hotspotId);
    const entry = self._anchorTrackers[key];
    if (!entry) return;
    if (entry.rafId) cancelAnimationFrame(entry.rafId);
    entry.tracker?.dispose?.();
    delete self._anchorTrackers[key];
  };

  function yawPitchToPixel(yawDeg, pitchDeg, W, H) {
    const yaw = (yawDeg + 180) / 360;
    const pitch = (90 - pitchDeg) / 180; // top=0
    let x = Math.round(yaw * (W - 1));
    let y = Math.round(pitch * (H - 1));
    x = Math.max(0, Math.min(W - 1, x));
    y = Math.max(0, Math.min(H - 1, y));
    return { x, y };
  }
  function pixelToYawPitch(x, y, W, H) {
    const yawDeg = (x / (W - 1)) * 360 - 180;
    const pitchDeg = 90 - (y / (H - 1)) * 180;
    return { yawDeg, pitchDeg };
  }

  function loadTFDependencies() {
    const haveTF = !!window.tf;
    const loaders = [];
    if (!haveTF) {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.14.0/dist/tf.min.js';
      s.async = true;
      loaders.push(new Promise(res => { s.onload = res; document.head.appendChild(s); }));
    }
    return Promise.all(loaders).then(() => {
      if (!window.mobilenet) {
        const s2 = document.createElement('script');
        s2.src = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet@2.1.0';
        s2.async = true;
        return new Promise(res => { s2.onload = res; document.head.appendChild(s2); });
      }
    });
  }

  function l2NormalizeManual(tensor, axis) {
    const epsilon = 1e-10;
    const squareSum = tf.sum(tf.square(tensor), axis, true);
    const invNorm = tf.rsqrt(tf.maximum(squareSum, epsilon));
    return tf.mul(tensor, invNorm);
  }

  // Tracker leggero: MobileNet feature + correlazione su search crop, con wrap 360
  class AnchorTrackerTFJS {
    constructor() {
      this.model = null;
      this.templateFeat = null;
      this.templateBox = null;
      this.W = 0; this.H = 0;
      this.extCanvas = null;
      this.extCtx = null;
      this.srcCanvas = null;
      this.ctx = null;
      this.videoEl = null;
      this.scales = [0.9, 1.0, 1.1];
    }

    async initFromVideo(videoEl, initBox) {
      await loadTFDependencies();
      if (!this.model) {
        this.model = await mobilenet.load({ version: 2, alpha: 1.0 });
      }
      this.videoEl = videoEl;
      this.W = videoEl.videoWidth;
      this.H = videoEl.videoHeight;

      // Canvas sorgente per snapshot
      this.srcCanvas = document.createElement('canvas');
      this.srcCanvas.width = this.W; this.srcCanvas.height = this.H;
      this.ctx = this.srcCanvas.getContext('2d', { willReadFrequently: true });

      // Canvas estesa [frame | frame | frame] a larghezza 3W per wrap
      this.extCanvas = document.createElement('canvas');
      this.extCanvas.width = this.W * 3;
      this.extCanvas.height = this.H;
      this.extCtx = this.extCanvas.getContext('2d', { willReadFrequently: true });

      this.templateBox = this._sanitizeBox(initBox, this.W, this.H);

      // Primo build esteso e template feature
      this._buildExtendedCanvas();
      const templateCrop = this._cropWrapped(this.templateBox, 160, 160);
      this.templateFeat = await this._embed(templateCrop);
    }

    dispose() {
      try { this.templateFeat?.dispose?.(); } catch(e) {}
      this.templateFeat = null;
      this.srcCanvas = null; this.ctx = null;
      this.extCanvas = null; this.extCtx = null;
      this.videoEl = null;
    }

    async update(priorBox) {
      // Disegna frame corrente e ricostruisci esteso
      this.ctx.drawImage(this.videoEl, 0, 0, this.W, this.H);
      this._buildExtendedCanvas();

      // Search attorno al prior
      const search = this._makeSearchFromState(priorBox || this.templateBox, 3.0);
      const searchCrop = this._cropWrapped(search, 320, 320);

      let best = { score: -Infinity, box: null };
      for (const s of this.scales) {
        const tplW = Math.max(20, Math.round(this.templateBox.w * s));
        const tplH = Math.max(20, Math.round(this.templateBox.h * s));
        const tplCrop = this._cropWrapped(
          { x: this.templateBox.x, y: this.templateBox.y, w: tplW, h: tplH }, 160, 160
        );
        const tplFeat = await this._embed(tplCrop);
        const { dx, dy, score } = await this._xcorr(searchCrop, tplFeat);
        tplFeat.dispose?.();

        const cx = search.x + search.w / 2 + dx * (search.w / 320);
        const cy = search.y + search.h / 2 + dy * (search.h / 320);
        const w = tplW, h = tplH;

        if (score > best.score) {
          best = { score, box: this._sanitizeBox({ x: Math.round(cx - w/2), y: Math.round(cy - h/2), w, h }, this.W, this.H) };
        }
      }

      return best;
    }

    async _embed(canvas) {
      const tfimg = tf.browser.fromPixels(canvas);
      const resized = tf.image.resizeBilinear(tfimg, [160, 160]);
      const normalized = resized.toFloat().div(127.5).sub(1.0);
      const batched = normalized.expandDims(0);
      const feat = this.model.infer(batched, { embedding: true }); // [1, 1024]
      tfimg.dispose(); resized.dispose(); normalized.dispose(); batched.dispose?.();
      return feat;
    }

    async _xcorr(searchCanvas, templateFeat) {
      // Griglia di patch 17x17 su 320x320
      const GRID = 17;
      const stepX = Math.floor((searchCanvas.width - 160) / (GRID - 1));
      const stepY = Math.floor((searchCanvas.height - 160) / (GRID - 1));
      let best = { score: -Infinity, dx: 0, dy: 0 };

      const centers = [];
      for (let gy = 0; gy < GRID; gy++) {
        for (let gx = 0; gx < GRID; gx++) {
          centers.push({ x: gx * stepX, y: gy * stepY });
        }
      }
      var input;
      const batchSize = 16;
      for (let i = 0; i < centers.length; i += batchSize) {
        const batch = centers.slice(i, i + batchSize);
        input = tf.tidy(() => {
          const ts = batch.map(pt => {
            const patch = this._cropCanvas(searchCanvas, pt.x, pt.y, 160, 160);
            const img = tf.browser.fromPixels(patch);
            const resized = tf.image.resizeBilinear(img, [160, 160]);
            const norm = resized.toFloat().div(127.5).sub(1.0);
            img.dispose(); resized.dispose();
            return norm.expandDims(0);
          });
          return tf.concat(ts, 0);
        });
        const feats = this.model.infer(input, { embedding: true }); // <-- questa riga mancava
        const featsNorm = l2NormalizeManual(feats, -1);
        const tplNorm = l2NormalizeManual(templateFeat, -1);

        const sim = tf.matMul(featsNorm, tf.transpose(tplNorm)); // [B,1]
        const simArr = await sim.array();

        for (let b = 0; b < batch.length; b++) {
          const score = simArr[b][0];
          if (score > best.score) {
            const patchCenterX = batch[b].x + 80;
            const patchCenterY = batch[b].y + 80;
            best = { score, dx: patchCenterX - 160, dy: patchCenterY - 160 };
          }
        }
        tf.dispose([input, feats, sim]);
      }
      return best;
      }

    _sanitizeBox(b, W, H) {
      const x = Math.max(0, Math.min(W - 1, b.x|0));
      const y = Math.max(0, Math.min(H - 1, b.y|0));
      const w = Math.max(10, Math.min(W, b.w|0));
      const h = Math.max(10, Math.min(H, b.h|0));
      return { x, y, w, h };
    }

    _makeSearchFromState(box, scale) {
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      const w = Math.min(this.W, Math.round(box.w * scale));
      const h = Math.min(this.H, Math.round(box.h * scale));
      const x = Math.round(cx - w / 2);
      const y = Math.round(cy - h / 2);
      return { x, y, w, h }; // non clampiamo qui: il wrap lo gestiamo in _cropWrapped
    }

    _buildExtendedCanvas() {
      // [frame @ 0W | frame @ 1W | frame @ 2W]
      this.extCtx.clearRect(0, 0, this.extCanvas.width, this.extCanvas.height);
      this.extCtx.drawImage(this.videoEl, 0, 0, this.W, this.H);
      this.extCtx.drawImage(this.videoEl, this.W, 0, this.W, this.H);
      this.extCtx.drawImage(this.videoEl, this.W * 2, 0, this.W, this.H);
    }

    _cropWrapped(box, outW, outH) {
      const c = document.createElement('canvas');
      c.width = outW; c.height = outH;
      const ctx = c.getContext('2d');

      // Prendiamo sempre dalla canvas estesa, centrando a x+W
      const sx = box.x + this.W;
      const sy = Math.max(0, Math.min(this.H - 1, box.y));
      const sw = box.w;
      const sh = box.h;
      ctx.drawImage(this.extCanvas, sx, sy, sw, sh, 0, 0, outW, outH);
      return c;
    }

    _cropCanvas(sourceCanvas, sx, sy, w, h) {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.drawImage(sourceCanvas, sx, sy, w, h, 0, 0, w, h);
      return c;
    }
  }*/

  return Video360Player;
})(H5P.jQuery);