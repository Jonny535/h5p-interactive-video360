H5P.Video360Interactive = (function ($, EventDispatcher) {

  function V360Interactive(params, id, extras) {
    const self = this;
    console.group('💾 [Runnable] Debug params caricati');
    console.log('params completi:', params);
    if (params.interactionSettings) {
      console.log('interactionSettings:', params.interactionSettings);
      if (params.interactionSettings.addHotspot) {
        console.log('addHotspot:', params.interactionSettings.addHotspot);
        console.log('Hotspots array:', params.interactionSettings.addHotspot.hotspots);
      } else {
        console.warn('⚠ Nessun addHotspot nei params');
      }
    } else {
      console.warn('⚠ Nessun interactionSettings nei params');
    }
    console.groupEnd();
    EventDispatcher.call(self);

    self.params = params || {};
    self.id = id;
    self.player = null;
    self.$wrapper = null;
    self.hotspotsContent = {};
    self.dynamicHotspots = {};
    self.hotspotMeshes = {};
    self.$activeOverlay = null; 

    self.hotspots = params?.interactionSettings?.addHotspot?.hotspots || [];
    console.log("🔥 Hotspots caricati dal runnable:", self.hotspots);
    if (typeof THREE !== undefined) window.THREE = THREE;
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
      self.loadHotspots();
      self.player.on('timeupdate', self.handleHotspotVisibility.bind(self));
      self.player.on('timeupdate', self.handleDynamicHotspotInterpolation.bind(self));
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
    const hotspots = self.hotspots;
    const scene = self.player.vr().scene;

    hotspots.forEach((hotspot) => {
      if (!hotspot.type || !hotspot.type.library) return;

      self.hotspotsContent[hotspot.id] = H5P.newRunnable(
        hotspot.type, 
        self.contentId, 
        H5P.jQuery(document), 
        undefined, 
        { parent: self }
      );

      const imagePath = hotspot.hotspotType === 'dynamic' ? H5P.getPath('marker-dynamic.png', self.contentId) : H5P.getPath('marker-static.png', self.contentId);
      const textureLoader = new THREE.TextureLoader();
      textureLoader.load(imagePath, (texture) => {
        const material = new THREE.SpriteMaterial({ map: texture, transparent: true});
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(30, 30, 1);
        sprite.name = `hotspot_marker_${hotspot.id}`;
        sprite.userData = {
          hotspotId: hotspot.id,
          hotspotType: hotspot.hotspotType,
          startTime: hotspot.displayStartTime,
          endTime: hotspot.displayEndTime,
          keyframes: hotspot.keyframes,
          title: hotspot.title || 'Hotspot',
          library: hotspot.type.library
        };

        // Events
        sprite.on('click', () => self.handleHotspotClick(hotspot.id));
        sprite.on('mouseover', (event) => self.showHotspotOverlay(event, sprite.userData));
        sprite.on('mouseout', () => self.hideHotspotOverlay());

        scene.add(sprite);
        self.hotspotMeshes[hotspot.id] = sprite;

        if (hotspot.hotspotType === 'dynamic') {
          self.dynamicHotspots[hotspot.id] = sprite;
          sprite.userData.keyframes.sort((a, b) => a.time - b.time);
        } else if (hotspot.hotspotType === 'static') {
          self.updateStaticPosition(sprite, hotspot);
        }
      });
    });

    self.updateAllHotspotPositions(0);
  }

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
    const currentTime = self.player.currentTime;
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
    const currentTime = self.player.currentTime;
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