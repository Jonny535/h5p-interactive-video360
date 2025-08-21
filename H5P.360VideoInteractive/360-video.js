H5P.Video360Interactive = (function ($, EventDispatcher) {

  function V360Interactive(params, id, extras) {
    const self = this;
    EventDispatcher.call(self);
    console.log(params);

    self.params = params || {};
    self.id = id;

    // 🔥 Inizializza hotspots di test scritti a mano
    this.hotspots = [
      {
        id: 1,
        hotspotType: 'static',
        yaw: 180,           // gradi
        pitch: 0,         // gradi
        displayStartTime: 1,
        displayEndTime: 15,
        positioned: true,
        type: {
          library: 'H5P.Table 1.2',  // ← aggiornata alla libreria tabella
          params: {
            table: [
              ['Colonna 1', 'Colonna 2'],
              ['Riga 1 - cella 1', 'Riga 1 - cella 2'],
              ['Riga 2 - cella 1', 'Riga 2 - cella 2']
            ]
          }
        }
      },
      {
        id: 2,
        hotspotType: 'dynamic',
        keyframes: [
          { time: 0, yaw: 0, pitch: 0, positioned: true },
          { time: 5, yaw: 45, pitch: 10, positioned: true },
          { time: 10, yaw: 90, pitch: 0, positioned: true }
        ],
        interpolated: true,
        type: {
          library: 'H5P.Text 1.1',
          params: { text: 'Hotspot dinamico di prova' }
        }
      }
    ];

    self.player = null;
    self.$wrapper = null;
    self.hotspotsContent = {};
    self.dynamicHotspots = {};
    self.hotspotMeshes = {};
    self.$activeOverlay = null;
    self.raycaster = new THREE.Raycaster();
    self.mouse = new THREE.Vector2();
    self.$domElement = null;
  }

  V360Interactive.prototype.attach = function ($container) {
    const self = this;
    if (self.$wrapper === null) self.buildUI();
    $container.addClass('h5p-360video-interactive').append(self.$wrapper);
  };

  V360Interactive.prototype.buildUI = function () {
    const self = this;

    self.$wrapper = $('<div>', { 'class': 'h5p-360video-wrapper'});

    const $title = $('<h2>', { 'class': 'h5p-360video-title' });
    $title.append($('<i>', {
      'class': 'fa fa-video',
      'aria-hidden': 'true'
    }))
    $title.append(' ' + (self.params.videoSettings.videoTitle || 'Nuovo Video 360°'));
    self.$wrapper.append($title);
    
    // Find Video file
    const video = self.params.videoSettings.video || [];
    const file = video[0];

    if (file && file.path) {
      self.initVideoPlayer(H5P.getPath(file.path, self.contentId), file.mime || 'video/mp4');
    } else {
      self.$wrapper.append($('<div>', {
        'class': 'h5p-360video-no-video',
        'text': 'Nessun video caricato'
      }));
    }
  }

  V360Interactive.prototype.initVideoPlayer = function (url, mime) {
    const self = this;
    const $videoContainer = $('<div>', { 'class': 'h5p-video360-player-container'});
    self.$wrapper.append($videoContainer);

    const $videoElement = $('<video>', {
      'id': 'h5p-video360-video-' + H5P.createUUID(),
      'class': 'video-js vjs-default-skin vjs-big-play-centered',
      'playsinline': true,
      'preload': 'auto',
      'controls': true,
      'crossorigin': 'anonymous',
      'style': 'width: 100%; height: 500px;'
    });
    $videoContainer.append($videoElement);
    
    self.player = videojs($videoElement[0], {
      autoplay: false,
      inactivityTimeout: 0,
      sources: [{src: url, type: mime}]
    });

    if (self.player.vr) {
      self.player.vr({'projection': 360})
    }

    self.player.on('ready', () => {
      // Polling finché VR è pronto
      const waitForVR = () => {
        const vr = self.player.vr && self.player.vr();
        if (vr && vr.scene && vr.renderer && vr.renderer.domElement) {
          console.log("VR pronto ✅");
          // Salva il domElement per il Raycaster
          self.$domElement = vr.renderer.domElement;

          // Aggiungi qui eventuali listener per Raycaster
          self.$domElement.addEventListener('click', (event) => {
            self.handleRaycastEvent(event, 'click');
          });
          self.$domElement.addEventListener('mousemove', (event) => {
            self.handleRaycastEvent(event, 'hover');
          });

          // Ora possiamo caricare gli hotspot in sicurezza
          self.loadHotspots();

          // Avvia il tracking di visibilità/interpolazione
          self.player.on('timeupdate', self.handleHotspotVisibility.bind(self));
          self.player.on('timeupdate', self.handleDynamicHotspotInterpolation.bind(self));
        } else {
          // Riprova al prossimo frame
          requestAnimationFrame(waitForVR);
        }
      };

      waitForVR();
    });


    self.player.on('play', () => {
      self.player.controls(true);
    });

    self.player.on('error', (e) => {
      const error = self.player.error();
      $videoContainer.html('<div class="h5p-video360-player-message" style="color: red;">Errore nel caricamento del video: ' + (error ? error.message : 'Sconosciuto') + '</div>');
    });
  }

  V360Interactive.prototype.loadHotspots = function () {
    const self = this;

    const vrInstance = self.player.vr && self.player.vr();
    if (!vrInstance || !vrInstance.scene) {
      console.warn('VR scene non disponibile ancora, riprovo più tardi…');
      setTimeout(() => self.loadHotspots(), 100); // riprova fra 100ms
      return;
    }
    const scene = vrInstance.scene;
    // 🔹 Usiamo quelli definiti nel costruttore
    const hotspots = self.hotspots;

    hotspots.forEach((hotspot) => {
      if (!hotspot.type || !hotspot.type.library) return;

      self.hotspotsContent[hotspot.id] = H5P.newRunnable(
        hotspot.type, 
        self.contentId, 
        H5P.jQuery(document), 
        undefined, 
        { parent: self }
      );

      // 🔹 Creazione marker sferico
      const color = hotspot.hotspotType === 'dynamic' ? 0x00ff00 : 0xff0000;
      const geometry = new THREE.SphereGeometry(15, 16, 16);
      const material = new THREE.MeshBasicMaterial({ 
        color,
        depthTest: false,
        depthWrite: false
      });
      const sphere = new THREE.Mesh(geometry, material);

      sphere.name = `hotspot_marker_${hotspot.id}`;
      sphere.userData = {
        hotspotId: hotspot.id,
        hotspotType: hotspot.hotspotType,
        startTime: hotspot.displayStartTime,
        endTime: hotspot.displayEndTime,
        keyframes: hotspot.keyframes,
        yaw: hotspot.yaw,
        pitch: hotspot.pitch,
        title: hotspot.title || 'Hotspot',
        library: hotspot.type.library
      };

      scene.add(sphere);
      self.hotspotMeshes[hotspot.id] = sphere;

      if (hotspot.hotspotType === 'dynamic') {
        self.dynamicHotspots[hotspot.id] = sphere;
        sphere.userData.keyframes.sort((a, b) => a.time - b.time);
        const firstKF = sphere.userData.keyframes[0];
        self.updateStaticPosition(sphere, firstKF);
      } else if (hotspot.hotspotType === 'static') {
        self.updateStaticPosition(sphere, hotspot);
      }
    });

    self.updateAllHotspotPositions(0);
  }

  V360Interactive.prototype.handleRaycastEvent = function (event, type) {
    const self = this;
    if (!self.$domElement) return;

    // Calcola coordinate normalizzate del mouse (-1 a 1)
    const rect = self.$domElement.getBoundingClientRect();
    self.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    self.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    // Raycaster dalla camera VR
    self.raycaster.setFromCamera(self.mouse, self.player.vr().camera);

    // Controlla intersezioni con tutti i marker
    const meshes = Object.values(self.hotspotMeshes);
    const intersects = self.raycaster.intersectObjects(meshes, false);

    if (intersects.length > 0) {
      const mesh = intersects[0].object;
      const data = mesh.userData;

      if (type === 'click') {
        self.handleHotspotClick(data.hotspotId);
      } 
      else if (type === 'hover') {
        self.showHotspotOverlay(event, data);
      }
    } else if (type === 'hover') {
      self.hideHotspotOverlay();
    }
  };


  V360Interactive.prototype.updateStaticPosition = function (mesh, hotspot) {
    const self = this;
    if (hotspot.yaw === undefined || hotspot.pitch === undefined) return;

    const yawRad = hotspot.yaw * (Math.PI / 180);
    const pitchRad = hotspot.pitch * (Math.PI / 180);
    const distance = 500;
    const x = distance * Math.sin(yawRad) * Math.cos(pitchRad);
    const y = distance * Math.sin(pitchRad);
    const z = distance * Math.cos(yawRad) * Math.cos(pitchRad);

    mesh.position.set(x, y, z);
  }

  V360Interactive.prototype.updateAllHotspotPositions = function (time) {
    const self = this;
    Object.keys(self.hotspotMeshes).forEach(id => {
      const mesh = self.hotspotMeshes[id];
      const userData = mesh.userData;

      if (userData.hotspotType === 'dynamic') {
        self.interpolateHotspotPosition(mesh, userData.keyframes, time);
      }
    })
  }

  V360Interactive.prototype.handleHotspotVisibility = function () {
    const self = this;
    const currentTime = self.player.currentTime();
    if (!self.hotspotMeshes) return;

    Object.keys(self.hotspotMeshes).forEach(hotspotId => {
      const mesh = self.hotspotMeshes[hotspotId];
      const userData = mesh.userData;

      let isVisible = true;
      if (userData.startTime !== null && currentTime < userData.startTime) isVisible = false;
      if (userData.endTime !== null && currentTime >= userData.endTime) isVisible = false;

      mesh.visible = isVisible;
    });
  }

  V360Interactive.prototype.handleDynamicHotspotInterpolation = function () {
    const self = this;
    const currentTime = self.player.currentTime();
    self.updateAllHotspotPositions(currentTime)
  }

  V360Interactive.prototype.interpolateHotspotPosition = function (mesh, keyframes, currentTime) {
    const self = this;
    if (!keyframes || keyframes.length < 2) {
      mesh.visible = false;
      return;
    }

    let fKey = keyframes[0];
    let sKey = keyframes[keyframes.length - 1];

    for (let i = 0; i < keyframes.length - 1; i++) {
      if (currentTime >= keyframes[i].time && currentTime <= keyframes[i + 1].time) {
        fKey = keyframes[i];
        sKey = keyframes[i + 1];
        break;
      }
    }

    const timeDiff = sKey.time - fKey.time;
    const factor = timeDiff > 0 ? (currentTime - fKey.time) / timeDiff : 0;

    const yaw = fKey.yaw + (sKey.yaw - fKey.yaw) * factor;
    const pitch = fKey.pitch + (sKey.pitch - fKey.pitch) * factor;

    const yawRad = yaw * (Math.PI / 180);
    const pitchRad = pitch * (Math.PI / 180);
    const distance = 500;
    const x = distance * Math.sin(yawRad) * Math.cos(pitchRad);
    const y = distance * Math.sin(pitchRad);
    const z = distance * Math.cos(yawRad) * Math.cos(pitchRad);

    mesh.position.set(x, y, z);
    mesh.visible = true;
  }

  V360Interactive.prototype.handleHotspotClick = function (hotspotId) {
    const self = this;
    const h5pContent = self.hotspotsContent[hotspotId];
    if (!h5pContent) return;
    $('.h5p-hotspot-modal').remove();
    self.player.pause();
    
    const $modal = $('<div>', {'class': 'h5p-hotspot-modal'});
    const $modalContent = $('<div>', {'class': 'h5p-hotspot-modal-content'});
    const $closeButton = $('<span>', {'class': 'h5p-hotspot-modal-close', 'html': '&times;'});
    const $h5pWrapper = $('<div>', {'class': 'h5p-hotspot-content-wrapper'});
    
    $modalContent.append($closeButton, $h5pWrapper);
    $modal.append($modalContent);
    $('body').append($modal);

    h5pContent.attach($h5pWrapper);
    
    $closeButton.on('click', () => {
      $modal.remove();
      self.player.play();
    })

    $modal.on('click', (e) => {
      if ($(e.target).is($modal)) {
        $modal.remove();
        self.player.play();
      }
    });
  }

  V360Interactive.prototype.showHotspotOverlay = function (event, data) {
    const self = this;
    self.hideHotspotOverlay();

    const $overlay = $('<div>', {
      'class': 'h5p-hotspot-overlay',
      'html': `<strong>${data.title}</strong><br><em>${data.library}</em>`
    }).css({
      position: 'absolute',
      top: event.clientY + 10,
      left: event.clientX + 10,
      background: 'rgba(0,0,0,0.8)',
      color: '#fff',
      padding: '8px',
      borderRadius: '4px',
      zIndex: 9999,
      pointerEvents: 'none'
    })

    $('body').append($overlay);
    self.$activeOverlay = $overlay;
  }

  V360Interactive.prototype.hideHotspotOverlay = function () {
    const self = this;
    if (self.$activeOverlay) {
      self.$activeOverlay.remove();
      self.$activeOverlay = null;
    }
  }
  
  return V360Interactive;
})(H5P.jQuery, H5P.EventDispatcher);