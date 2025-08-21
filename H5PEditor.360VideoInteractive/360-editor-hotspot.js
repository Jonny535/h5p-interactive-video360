/**
 * Editor widget for editing hotspot interactions on video 360
*/
H5PEditor.widgets.hotspoticon = (function ($) {
  'use strict';
  /**
   * Constructor for HotspotIcon widget
   * @param {object} parent - H5P editor parent
   * @param {object} field - Semantics field for this widget
   * @param {object} params - Saved params
   * @param {function} setValue - Callback to update params
  */
  function HotspotIcon(parent, field, params, setValue) {
    const self = this;
    H5PEditor.Group.call(self, parent, field, params, setValue); 

    self.parent = parent;
    self.field = field; 
    self.setValue = setValue;

    self.params = params || {};
    self.parentParams = self.parent.params;
    self.hotspotsField = self.field.fields.find(f => f.name === 'hotspots') || null;
    self.hotspotItemFields = self.getHotspotItemFields();

    self.$container = null;
    self.$list = null;
    self.$emptyList = null;

    self.videoPlayer = null;
    self.hotspotCnt = self.computeInitialId(self.params.hotspots);
    self.children = [];
    self.contentEditors = {};
    
    this.passReadies = true;
    parent.ready(() => self.passReadies = false);

    self.bindVideoPlayer();
  }

  HotspotIcon.prototype = Object.create(H5PEditor.Group.prototype);
  HotspotIcon.prototype.constructor = HotspotIcon;

  HotspotIcon.prototype.ready = function (ready) {
    if (this.passReadies) {
      this.parent.ready(ready);
    } else {
      this.readies.push(ready);
    }
  };

  HotspotIcon.prototype.getHotspotItemFields = function () {
    const self = this;
    return (self.hotspotsField && Array.isArray(self.hotspotsField.fields)) ? self.hotspotsField.fields : [];
  }

  HotspotIcon.prototype.computeInitialId = function (hotspots) {
    if (!Array.isArray(hotspots) || hotspots.length === 0) return 0;
    const maxId = hotspots.reduce((m, h) => Number.isInteger(h.id) ? Math.max(m, h.id) : m, -1);
    return Math.max(0, maxId + 1);
  }

  HotspotIcon.prototype.getVideoPlayerInstance = function () {
    const self = this;
    if (!self.parent || !self.parent.children) return null;
    return self.parent.children.find(child => child.field.name === 'videoPlayerPreview');
  }

  HotspotIcon.prototype.bindVideoPlayer = function () {
    const self = this;
    self.videoPlayer = self.getVideoPlayerInstance();

    if (!self.videoPlayer) {
      setTimeout(() => {
        self.videoPlayer = self.getVideoPlayerInstance();
        if (self.videoPlayer) self.attachVideoPlayerListerners();
      }, 0);
    } else {
      self.attachVideoPlayerListerners();
    }
  }

  HotspotIcon.prototype.attachVideoPlayerListerners = function () {
    const self = this;
    if (!self.videoPlayer || typeof self.videoPlayer.on !== 'function') return;

    self.videoPlayer.on('videoUrlUpdated', () => {
      self.hotspotCnt = self.computeInitialId(self.params.hotspots);
      self.renderHotspotList();
    });
    self.videoPlayer.on('play', () => $('.h5p-hotspot-position-button').not('.h5p-keyframe-position-button').removeAttr('disabled'));
    self.videoPlayer.on('hotspotInserted', (event) => self.handleHotspotPlacement(event));
  }

  HotspotIcon.prototype.safeIsVideoLoaded = function () {
    const self = this;
    return !!(self.videoPlayer && self.videoPlayer.videoUrl);
  }

  /* ---------- UI ---------- */
  HotspotIcon.prototype.appendTo = function ($wrapper) {
    const self = this;

      if (self.parent && self.parent.params && !self.parent.params[self.field.name]) {
        self.parent.params[self.field.name] = { hotspots: [] };
      }
      if (!Array.isArray(self.params.hotspots)) {
        self.params.hotspots = [];
      }

    // Container Label & Description
    self.$container = $('<div>', { 'class': 'h5p-hotspot-editor-container'});
    self.$container.append($('<div>', {'class': 'h5p-hotspot-label', 'html': self.field.label}));
    self.$container.append($('<div>', {'class': 'h5p-hotspot-description', 'html': self.field.description}));
    // Add button
    const $addButton = self.createAddButton();
    self.$container.append($addButton);
    // Empty Message
    self.$emptyList = $('<div>', {'text': 'Nessuna interazione aggiunta ancora.', 'class': 'h5p-hotspot-empty-message'});
    self.$container.append(self.$emptyList);
    // List of hotspots
    self.$list = $('<ul>', {'class': 'h5p-hotspot-list'});
    self.$container.append(self.$list);

    $wrapper.append(self.$container); // Append to DOM
    self.renderHotspotList();
  }

  HotspotIcon.prototype.renderHotspotList = function () {
    const self = this;
    if (!self.$list) return;
    
    const hotspots = Array.isArray(self.params.hotspots) ? self.params.hotspots : (self.params.hotspots = []);

    self.$list.empty(); // Clear

    // Show/Hide empty message and list
    if (hotspots.length === 0) {
      self.$emptyList.show();
      self.$list.hide();
      return;
    }
    self.$emptyList.hide();
    self.$list.show();
    // Access videoUrl directly from the videoPlayerWidget
    const isVideoLoaded = self.safeIsVideoLoaded();
    // Re-populate list
    hotspots.forEach((hotspot, index) => {
      const $listItem = self.createHotspotItem(hotspot, index, isVideoLoaded);
      self.$list.append($listItem);
    });
  }

  HotspotIcon.prototype.createAddButton = function () {
    const self = this;
    return $('<button>', {
      'class': 'h5p-hotspot-add-button h5p-editor-button',
      'html': '<i class="fa fa-plus-circle"></i> Aggiungi Nuova Interazione'
    }).on('click', () => self.addHotspot());
  }

  HotspotIcon.prototype.createHotspotItem = function (hotspot, index, isVideoLoaded) {
    const self = this;
    // Create li
    const $listItem = $('<li>', {'class': 'h5p-hotspot-list-item', 'data-hotspot-index': index});
    // Title input + delete btn
    const $header = $('<div>', {'class': 'h5p-hotspot-list-header'});
    const $titleInput = self.createTitleInput(hotspot);
    const $deleteButton = self.createDeleteButton(hotspot.id, index);
    $header.append($titleInput, $deleteButton);
    // Type select static/dynamic
    const $hotspotTypeGroup = self.createHotspotTypeSelect(hotspot, index);
    $listItem.append($header, $hotspotTypeGroup);
    // Static VS Dynamic logic
    if (hotspot.hotspotType === 'static') {
      const $staticGroup = self.createStaticFieldsGroup(hotspot, isVideoLoaded);
      $listItem.append($staticGroup);
    } else if (hotspot.hotspotType === 'dynamic') {
      const $dynamicGroup = self.createDynamicFieldsGroup(hotspot, isVideoLoaded);
      $listItem.append($dynamicGroup);
    }

    return $listItem;
  }

  HotspotIcon.prototype.createTitleInput = function (hotspot) {
    const self = this;

    const title = hotspot.title || `Interazione ${hotspot.id}`;
    return $('<input>', {
      'type': 'text',
      'class': 'h5p-hotspot-title-input',
      'value': title,
      'placeholder': 'Titolo Interazione'
    }).on('change', function () {
      hotspot.title = $(this).val();
      self.updateHotspotsData();
    })
  }

  HotspotIcon.prototype.createDeleteButton = function (id, index) {
    const self = this;

    return $('<button>', {
      'class': 'h5p-editor-button h5p-hotspot-delete-button',
      'html': '<i class="fa fa-trash"></i>'
    }).on('click', () => self.removeHotspot(id, index))
  }

  HotspotIcon.prototype.createHotspotTypeSelect = function (hotspot, index) {
    const self = this;

    const $selectGroup = $('<div>').addClass('h5p-hotspot-type-container');
    const $label = $('<span>', {'text': 'Tipo Hotspot:'});
    const $select = $('<select>', {'class': 'h5p-hotspot-type-select-dropdown'});
    // From semantics to select options dropdown
    const hotspotTypeField = self.hotspotItemFields.find(f => f.name === 'hotspotType');
    if (hotspotTypeField && Array.isArray(hotspotTypeField.options)) {
      hotspotTypeField.options.forEach(option => {
        $select.append($('<option>', {
          'value': option.value,
          'text': option.label,
          'selected': hotspot.hotspotType === option.value
        }));
      });
    }
    // Listener on change
    $select.on('change', function () {
      const hotspots = self.params.hotspots;
      const oldType = hotspots[index].hotspotType;
      const newType = $(this).val();
      hotspots[index].hotspotType = newType; // Set new type to current hotspot

      if (oldType !== newType) {
        self.videoPlayer && self.videoPlayer.removeMarker(hotspot.id);
        // STATIV V DYNAMIC
        if (newType === 'dynamic') {
          hotspots[index].keyframes = [];
          // Not single yaw and pitch so delete them
          delete hotspots[index].yaw;
          delete hotspots[index].pitch;
        } else {
          const keyframes = hotspots[index].keyframes || [];
          keyframes.forEach((_, i) => self.videoPlayer && self.videoPlayer.removeKeyframeMarker && self.videoPlayer.removeKeyframeMarker(hotspot.id, i));
          hotspots[index].yaw = 0;
          hotspots[index].pitch = 0;
          delete hotspots[index].keyframes;
        }
      }

      self.updateHotspotsData();
    });
    $selectGroup.append($label, $select);
    return $selectGroup;
  }

  HotspotIcon.prototype.createStaticFieldsGroup = function (hotspot, isVideoLoaded) {
    const self = this;

    const $group = $('<div>', {'class': 'h5p-hotspot-static-fields-group'});
    const $positionButton = self.createPositionButton(hotspot.id, isVideoLoaded);
    $group.append($positionButton);

    if (hotspot.positioned) {
      const $detailsWrapper = $('<div>', {'class': 'h5p-hotspot-details-wrapper'});

      const $coordsContainer = self.createCoordsInfo(hotspot);    
      const $timeContainer = self.createTimeInfo(hotspot);
      $detailsWrapper.append($coordsContainer, $timeContainer);

      const $contentEditorContainer = $('<div>', {'class': 'h5p-hotspot-content-editor-container'});
      const $contentTypeSelectGroup = self.createContentTypeSelect(hotspot, $contentEditorContainer);
      $detailsWrapper.append($contentTypeSelectGroup, $contentEditorContainer);
      $group.append($detailsWrapper);

      const $toggleButton = self.createToggleButton($detailsWrapper);
      $group.append($toggleButton);
    }
    
    return $group;
  }

  HotspotIcon.prototype.createPositionButton = function (id, isVideoLoaded) {
    const self = this;

    const $button = $('<button>', {
      'class': 'h5p-editor-button h5p-hotspot-position-button',
      'html': '<i class="fa fa-crosshairs"></i> Posiziona su Video'
    }).on('click', function () {
      if (self.videoPlayer && typeof self.videoPlayer.startHotspotPlacement === 'function') {
        self.videoPlayer.startHotspotPlacement(id, undefined);
        $('.h5p-hotspot-position-button').attr('disabled', 'disabled');
      }
    });

    if (!isVideoLoaded || !self.videoPlayer.videoStarted) $button.attr('disabled', 'disabled');
    return $button;
  }

  HotspotIcon.prototype.createCoordsInfo = function (hotspot) {
    const $coordsContainer = $('<div>', {'class': 'h5p-hotspot-coords-container'});

    const yaw = hotspot.yaw !== undefined ? parseFloat(hotspot.yaw).toFixed(2) : 'N/A';
    const pitch = hotspot.pitch !== undefined ? parseFloat(hotspot.pitch).toFixed(2) : 'N/A';

    $coordsContainer.append($('<div>', { 'html': `<span>Yaw:</span> ${yaw}°` }));
    $coordsContainer.append($('<div>', { 'html': `<span>Pitch:</span> ${pitch}°` }));

    return $coordsContainer;
  }

  HotspotIcon.prototype.createTimeInfo = function (hotspot) {
    const self = this;

    const $timeContainer = $('<div>', {'class': 'h5p-hotspot-time-container'});
    
    const formattedStartTime = self.videoPlayer.formatSecondsToMSS(hotspot.displayStartTime);
    const $startTimeGroup = $('<div>', { 'html': `<span>Ora di inizio (M:SS):</span> ${formattedStartTime}` });
    
    const formattedEndTime = self.videoPlayer.formatSecondsToMSS(hotspot.displayEndTime);
    const $endTimeGroup = $('<div>');
    const $error = $('<div>', { 'class': 'h5p-hotspot-time-error', 'text': 'Formato non valido (M:SS)'});

    $endTimeGroup.append($('<span>', { 'text': 'Ora di fine (M:SS):' }));
    $endTimeGroup.append($('<input>', {
      'type': 'text',
      'class': 'h5p-hotspot-time-input',
      'value': formattedEndTime,
      'placeholder': 'M:SS',
    }).on('change', function () {
      if (!self.videoPlayer || typeof self.videoPlayer.parseMSSToSeconds !== 'function') return;

      const input = $(this).val();
      const seconds = self.videoPlayer.parseMSSToSeconds(input);
      // Error on invalid input
      if (seconds === null || input === '') {
        $error.show();
        $(this).val(formattedEndTime);
        return;
      }
      $error.hide(); // Hide on valid input
      // Update data
      hotspot.displayEndTime = seconds;
      self.updateHotspotsData();
      // Update visual marker
      const scene = self.videoPlayer.player?.vr()?.scene;
      if (scene) {
        const marker = scene.getObjectByName(`hotspot_marker_${hotspot.id}`);
        if (marker && marker.userData) {
          marker.userData.endTime = seconds;
          self.player.updateStaticHotspotsVisibility();
        }
        self.videoPlayer.player.trigger('timeupdate');
      }
    }));

    $timeContainer.append($startTimeGroup, $endTimeGroup);
    return $timeContainer;
  }

  HotspotIcon.prototype.createDynamicFieldsGroup = function (hotspot, isVideoLoaded) {
    const self = this;
    const $group = $('<div>', {'class': 'h5p-hotspot-dynamic-fields-group'});
    const keyframes = Array.isArray(hotspot.keyframes) ? hotspot.keyframes : (hotspot.keyframes = []);
    const numKeyframes = keyframes.length;

    if (!hotspot.interpolated) {
      const $keyframesContainer = $('<div>', {'class': 'h5p-hotspot-keyframes-container'});
      $keyframesContainer.append($('<span>', {'text': 'Keyframes:'}));

      hotspot.keyframes.forEach((keyframe, i) => {
        $keyframesContainer.append(self.createKeyframeItem(keyframe, hotspot.id, i, isVideoLoaded));
      });

      const $keyframeButtons = $('<div>', {'class': 'h5p-hotspot-keyframe-buttons'});
      // Logic for sequential buttons
      const MAX_KEYFRAMES = 3;
      for (let i = 0; i < MAX_KEYFRAMES; i++) {
        const isEnabled = numKeyframes === i;
        const label = `Punto ${i + 1}`;
        const $btn = self.createKeyframePlacementButton(hotspot.id, i, label, isVideoLoaded, isEnabled);
        $keyframeButtons.append($btn);
      }

      const $interpolateButton = self.createInterpolateButton(hotspot);
      $group.append($keyframesContainer, $keyframeButtons, $interpolateButton);

    } else {
      const $timeContainer = self.createDynamicTimeInfo(hotspot.keyframes);
      const $contentEditorContainer = $('<div>', {'class': 'h5p-hotspot-content-editor-container'});
      const $contentTypeSelectGroup = self.createContentTypeSelect(hotspot, $contentEditorContainer);
      $group.append($timeContainer, $contentTypeSelectGroup, $contentEditorContainer);
    }

    return $group;
  }

  HotspotIcon.prototype.createKeyframeItem = function (keyframe, id, keyframeIndex, isVideoLoaded) {
    const self = this;
    const $item = $('<div>', {'class': 'h5p-hotspot-keyframe-item'});
    // Keyframe infos
    const label = `Keyframe ${keyframeIndex + 1}`;
    const time = keyframe.time !== undefined ? keyframe.time.toFixed(2) : 'N/A';
    const formattedTime = self.videoPlayer.formatSecondsToMSS(time);
    const yaw = keyframe.yaw !== undefined ? keyframe.yaw.toFixed(2) : 'N/A';
    const pitch = keyframe.pitch !== undefined ? keyframe.pitch.toFixed(2) : 'N/A';

    $item.append($('<span>', {'html': `${label} (Tempo: ${formattedTime}s, Yaw: ${yaw}°, Pitch: ${pitch}°)`}));
    // Repositioning button for specific keyframe
    const $repositionButton = self.createKeyframePlacementButton(id, keyframeIndex, 'Riposiziona', isVideoLoaded, true, true);
    $item.append($repositionButton);

    return $item;
  }

  HotspotIcon.prototype.createKeyframePlacementButton = function (hotspotIndex, keyframeIndex, label, isVideoLoaded, isEnabled, isRepositioning = false) {
    const self = this;

    const $button = $('<button>', {
      'class': 'h5p-editor-button h5p-hotspot-position-button h5p-keyframe-position-button',
      'html': isRepositioning ? `<i class="fa fa-crosshairs"></i> ${label}` : label
    }).on('click', function () {
      if (self.videoPlayer && typeof self.videoPlayer.startHotspotPlacement === 'function') {
        self.videoPlayer.startHotspotPlacement(hotspotIndex, keyframeIndex);
        $('.h5p-hotspot-position-button').attr('disabled', 'disabled');
      }
    });

    if (!isVideoLoaded || !self.videoPlayer.videoStarted || !isEnabled) $button.attr('disabled', 'disabled');

    return $button;
  }

  HotspotIcon.prototype.createInterpolateButton = function (hotspot) {
    const self = this;
    const numKeyframes = Array.isArray(hotspot.keyframes) ? hotspot.keyframes.length : 0;

    const $button = $('<button>', {
      'class': 'h5p-editor-button h5p-hotspot-interpolate-button',
      'text': 'Interpola Keyframes',
      'data-hotspot-index': hotspot.id
    }).on('click', function () {
      if (self.videoPlayer && typeof self.videoPlayer.interpolateHotspot === 'function') {
        self.videoPlayer.interpolateHotspot(hotspot.id, hotspot.keyframes || []);
      }
      const target = self.params.hotspots.find(h => h.id === hotspot.id);
      if (target) {
        target.interpolated = true;
        self.updateHotspotsData();
      }
    });

    if (numKeyframes < 3) {
      $button.attr('disabled', 'disabled');
    }

    return $button;
  }

  HotspotIcon.prototype.createDynamicTimeInfo = function (keyframes) {
    const self = this;
    const $timeContainer = $('<div>', {'class': 'h5p-hotspot-time-container'});
    // Time of first and last keyframes
    if (!Array.isArray(keyframes) || keyframes.length === 0) {
      return $('<div>', { 'class': 'h5p-hotspot-time-container', 'text': 'Nessun keyframe disponibile.' });
    }
    const a = keyframes[0];
    const z = keyframes[keyframes.length - 1];
    const timeA = self.videoPlayer.formatSecondsToMSS(a.time);
    const timeZ = self.videoPlayer.formatSecondsToMSS(z.time);
    // StartTime
    const $startTimeGroup = $('<div>');
    $startTimeGroup.append($('<span>', { 'text': 'Ora di inizio (M:SS):' }));
    $startTimeGroup.append($('<div>', { 'text': timeA }));
    $timeContainer.append($startTimeGroup);
    // EndTime
    const $endTimeGroup = $('<div>');
    $endTimeGroup.append($('<span>', { 'text': 'Ora di fine (M:SS):' }));
    $endTimeGroup.append($('<div>', { 'text': timeZ }));
    $timeContainer.append($endTimeGroup);

    return $timeContainer;
  }

  HotspotIcon.prototype.createToggleButton = function ($details) {
    const $button = $('<button>', {
      'class': 'h5p-hotspot-toggle-button',
      'html': '<i class="fa fa-chevron-up"></i>'
    }).on('click', function () {
      $details.slideToggle(200);
      $(this).find('i').toggleClass('fa-chevron-up fa-chevron-down')
    });

    return $button;
  }

  HotspotIcon.prototype.createContentTypeSelect = function (hotspot, $contentEditorContainer) {
    const self = this;

    const $selectGroup = $('<div>').addClass('h5p-hotspot-content-type-select-group');
    const $label = $('<span>', { 'text': 'Contenuto dell\'Interazione:' });
    const $contentForm = $('<div>', {'class': 'h5p-hotspot-content-form'});

    const contentTypeFieldDef = self.hotspotItemFields.find(f => f.name === 'type');
    
    if (contentTypeFieldDef) {
        H5PEditor.processSemanticsChunk(
            [contentTypeFieldDef], 
            hotspot, 
            $contentForm,
            self
        );
    }
    const $select = $contentForm.find('select');
    
    $select.on('change', function () {
      const selectedLibrary = $(this).val();      
      const currentHotspot = self.params.hotspots.find(h => h.id === hotspot.id);
    
      currentHotspot.type = {library: selectedLibrary, params: {}};
      self.updateHotspotsData();
      
      $contentEditorContainer.empty();
    });

    $selectGroup.append($label, $contentForm);
    
    $contentEditorContainer.append($contentForm);

    return $selectGroup;
  }

  /* ---------- EVENTS ---------- */
  HotspotIcon.prototype.handleHotspotPlacement = function (event) {
    const self = this;
    const data = event.data || {};
    const HID = (data.id !== undefined) ? data.id : undefined;
    const keyframeIndex = (data.keyframeIndex !== undefined) ? data.keyframeIndex : undefined;

    if (HID === undefined) return;

    const hotspot = self.params.hotspots.find(h => h.id === HID);

    if (hotspot.hotspotType === 'dynamic') {
      // DYNAMIC
      hotspot.keyframes = Array.isArray(hotspot.keyframes) ? hotspot.keyframes : [];
      const keyframe = hotspot.keyframes[keyframeIndex] || {};
      Object.assign(keyframe, {
        yaw: data.yaw,
        pitch: data.pitch,
        time: parseFloat(self.videoPlayer.player.currentTime().toFixed(2)),
        positioned: true
      });
      hotspot.keyframes[keyframeIndex] = keyframe;
    } else {
      // STATIC
      Object.assign(hotspot, {
        yaw: data.yaw,
        pitch: data.pitch,
        displayStartTime: parseFloat(self.videoPlayer.player.currentTime().toFixed(2)),
        positioned: true
      });
    }

    if (hotspot.hotspotType === 'dynamic') {
      const n = hotspot.keyframes.filter(k => k.positioned).length;
      if (n < 3) $(`.h5p-keyframe-position-button:eq(${n})`).removeAttr('disabled');
      if (n === 3) $(`.h5p-hotspot-interpolate-button[data-hotspot-index="${HID}"]`).removeAttr('disabled');
    }

    $('.h5p-hotspot-position-button').removeAttr('disabled');
    self.updateHotspotsData();
  }

  HotspotIcon.prototype.updateHotspotsData = function () {
    const self = this;
    self.setValue(self.field, self.params)
    self.renderHotspotList();

  }

  HotspotIcon.prototype.addHotspot = function () {
    const self = this;
    if (!Array.isArray(self.params.hotspots)) {
      self.params.hotspots = [];
    }
    // Wait till item created or retry
    let newId = self.hotspotCnt++;
    while (self.params.hotspots.some(h => h.id === newId)) {
      newId = self.hotspotCnt++;
    }

    const newHotspot = {};
    self.hotspotItemFields.forEach(fieldDef => {
      if (fieldDef.default !== undefined) {
        newHotspot[fieldDef.name] = fieldDef.default;
      }
    });

    newHotspot.title = `Nuova Interazione ${self.params.hotspots.length + 1}`;
    newHotspot.hotspotType = newHotspot.hotspotType || 'static';
    newHotspot.positioned = false;
    newHotspot.interpolated = false;
    newHotspot.id = newId;
    newHotspot.displayStartTime = newHotspot.displayStartTime !== undefined ? newHotspot.displayStartTime : 0;
    newHotspot.displayEndTime = newHotspot.displayEndTime !== undefined ? newHotspot.displayEndTime : 0;
    newHotspot.keyframes = [];
    
    // Push new hotspot into the list
    self.params.hotspots.push(newHotspot);
    self.updateHotspotsData();
  }

  HotspotIcon.prototype.removeHotspot = function (id, index) {
    const self = this;
    const hotspots = self.params.hotspots;

    if (index >= 0 && index < hotspots.length) {
      self.videoPlayer.removeMarker(id);
      // Remove keyframes
      const hotspot = hotspots.find(h => h.id === id);
      if (hotspot.keyframes && Array.isArray(hotspot.keyframes)) {
        for (let i = 0; i < hotspot.keyframes.length; i++) {
          self.videoPlayer.removeKeyframeMarker(id, i);
        }
      }
      hotspots.splice(index, 1);
      self.updateHotspotsData()
    }
  }

  HotspotIcon.prototype.validate = function () {
    const self = this;
    if (!self.params) {
      self.params = { hotspot: [] };
    } else if (!self.params.hotspots) {
      self.params.hotspots = [];
    }

    self.params.hotspots.forEach(hotspot => {
      if (!hotspot.id) {
        hotspot.id = H5P.createUUID();
      }
    })

    self.setValue(self.field, self.params)
    // Se vuoi tracciare anche lo stack
    console.trace("🟣 validate stacktrace");    
    return true;
}

  HotspotIcon.prototype.remove = function () {
    const self = this;
  
    if (self.children) {
      self.children.forEach(function(child) {
        if (child && typeof child.remove === 'function') {
          child.remove();
        }
      });
      self.children = [];
    }
    
    if (self.$container) {
      self.$container.remove();
    }
  }

  return HotspotIcon;
})(H5P.jQuery);