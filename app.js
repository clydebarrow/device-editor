class DeviceEditor {
    constructor() {
        // Initialize form elements
        this.form = document.getElementById('deviceForm');
        this.chipTypeSelect = document.getElementById('chipType');
        this.yamlDropZone = document.getElementById('yamlDropZone');
        this.imageDropZone = document.getElementById('imageDropZone');
        this.imageInput = document.getElementById('images');
        this.imagePreview = document.getElementById('imagePreview');
        this.tagInput = document.getElementById('tagInput');
        this.tagSuggestions = document.getElementById('tagSuggestions');
        this.selectedTags = document.getElementById('selectedTags');
        this.gpioPinList = document.getElementById('gpioPinList');
        this.slugInput = document.getElementById('slug');
        this.yamlOverlay = this.yamlDropZone.querySelector('.drop-zone-overlay');
        this.imageOverlay = this.imageDropZone.querySelector('.drop-zone-overlay');
        this.contextMenu = document.getElementById('contextMenu');
        this.toast = document.getElementById('toast');
        
        // Initialize CodeMirror
        this.yamlEditor = CodeMirror.fromTextArea(document.getElementById('yamlCode'), {
            mode: 'yaml',
            theme: 'monokai',
            lineNumbers: true,
            indentUnit: 2,
            smartIndent: true,
            lineWrapping: true
        });

        // Server configuration
        this.serverConfig = {
            submitUrl: 'http://localhost:5003/submit',
            authUrl: 'http://localhost:5003/auth/github',
            authCheckUrl: 'http://localhost:5003/auth/check',
            maxImageSize: 5 * 1024 * 1024  // 5MB max per image
        };

        // Initialize validation state
        this.validationState = {
            hasTags: false,
            hasGpioPins: false,
            hasImages: false,
            hasYaml: false,
            wasValidated: false
        };

        // Initialize tag system
        this.selectedTagsList = new Set();
        this.availableTags = [
            'display',
            'wifi',
            'ethernet',
            'battery',
            'sensor',
            'light',
            'switch',
            'relay',
            'climate',
            'cover',
            'fan',
            'camera',
            'audio',
            'security',
            'automation',
            'development'
        ];

        // Initialize chip pins
        this.chipPins = {
            'ESP32': [
                'GPIO00', 'GPIO01', 'GPIO02', 'GPIO03', 'GPIO04', 'GPIO05',
                'GPIO06', 'GPIO07', 'GPIO08', 'GPIO09', 'GPIO10', 'GPIO11',
                'GPIO12', 'GPIO13', 'GPIO14', 'GPIO15', 'GPIO16', 'GPIO17',
                'GPIO18', 'GPIO19', 'GPIO21', 'GPIO22', 'GPIO23', 'GPIO25',
                'GPIO26', 'GPIO27', 'GPIO32', 'GPIO33', 'GPIO34', 'GPIO35',
                'GPIO36', 'GPIO39'
            ],
            'ESP32-S2': [
                'GPIO00', 'GPIO01', 'GPIO02', 'GPIO03', 'GPIO04', 'GPIO05',
                'GPIO06', 'GPIO07', 'GPIO08', 'GPIO09', 'GPIO10', 'GPIO11',
                'GPIO12', 'GPIO13', 'GPIO14', 'GPIO15', 'GPIO16', 'GPIO17',
                'GPIO18', 'GPIO19', 'GPIO20', 'GPIO21', 'GPIO26', 'GPIO33',
                'GPIO34', 'GPIO35', 'GPIO36', 'GPIO37', 'GPIO38', 'GPIO39',
                'GPIO40', 'GPIO41', 'GPIO42', 'GPIO43', 'GPIO44', 'GPIO45'
            ],
            'ESP32-S3': [
                'GPIO00', 'GPIO01', 'GPIO02', 'GPIO03', 'GPIO04', 'GPIO05',
                'GPIO06', 'GPIO07', 'GPIO08', 'GPIO09', 'GPIO10', 'GPIO11',
                'GPIO12', 'GPIO13', 'GPIO14', 'GPIO15', 'GPIO16', 'GPIO17',
                'GPIO18', 'GPIO19', 'GPIO20', 'GPIO21', 'GPIO35', 'GPIO36',
                'GPIO37', 'GPIO38', 'GPIO39', 'GPIO40', 'GPIO41', 'GPIO42',
                'GPIO43', 'GPIO44', 'GPIO45', 'GPIO46', 'GPIO47', 'GPIO48'
            ],
            'ESP32-C3': [
                'GPIO00', 'GPIO01', 'GPIO02', 'GPIO03', 'GPIO04', 'GPIO05',
                'GPIO06', 'GPIO07', 'GPIO08', 'GPIO09', 'GPIO10', 'GPIO11',
                'GPIO12', 'GPIO13', 'GPIO14', 'GPIO15', 'GPIO16', 'GPIO17',
                'GPIO18', 'GPIO19', 'GPIO20', 'GPIO21'
            ],
            'RP2040': [
                'GPIO00', 'GPIO01', 'GPIO02', 'GPIO03', 'GPIO04', 'GPIO05',
                'GPIO06', 'GPIO07', 'GPIO08', 'GPIO09', 'GPIO10', 'GPIO11',
                'GPIO12', 'GPIO13', 'GPIO14', 'GPIO15', 'GPIO16', 'GPIO17',
                'GPIO18', 'GPIO19', 'GPIO20', 'GPIO21', 'GPIO22', 'GPIO23',
                'GPIO24', 'GPIO25', 'GPIO26', 'GPIO27', 'GPIO28', 'GPIO29'
            ],
            'RTL8710': [
                'GPIO00', 'GPIO01', 'GPIO02', 'GPIO03', 'GPIO04', 'GPIO05',
                'GPIO06', 'GPIO07', 'GPIO08', 'GPIO09', 'GPIO10', 'GPIO11',
                'GPIO12', 'GPIO13', 'GPIO14', 'GPIO15'
            ],
            'RTL8720': [
                'GPIO00', 'GPIO01', 'GPIO02', 'GPIO03', 'GPIO04', 'GPIO05',
                'GPIO06', 'GPIO07', 'GPIO08', 'GPIO09', 'GPIO10', 'GPIO11',
                'GPIO12', 'GPIO13', 'GPIO14', 'GPIO15'
            ],
            'BK7231': [
                'GPIO06', 'GPIO07', 'GPIO08', 'GPIO09', 'GPIO10', 'GPIO11',
                'GPIO14', 'GPIO15', 'GPIO16', 'GPIO17', 'GPIO18', 'GPIO19',
                'GPIO20', 'GPIO21', 'GPIO22', 'GPIO23', 'GPIO24', 'GPIO26'
            ],
            'BK7231T': [
                'GPIO06', 'GPIO07', 'GPIO08', 'GPIO09', 'GPIO10', 'GPIO11',
                'GPIO14', 'GPIO15', 'GPIO16', 'GPIO17', 'GPIO18', 'GPIO19',
                'GPIO20', 'GPIO21', 'GPIO22', 'GPIO23', 'GPIO24', 'GPIO26'
            ]
        };
        
        // Check authentication status
        this.checkAuthStatus();
        
        this.setupEventListeners();
    }

    async checkAuthStatus() {
        const loginBtn = document.getElementById('githubLogin');
        const userInfo = document.getElementById('userInfo');
        const userAvatar = document.getElementById('userAvatar');
        const userName = document.getElementById('userName');

        try {
            const response = await fetch(this.serverConfig.authCheckUrl, {
                credentials: 'include'
            });
            const data = await response.json();
            
            if (!data.authenticated) {
                loginBtn.classList.remove('hidden');
                userInfo.classList.add('hidden');
                document.getElementById('submitBtn').disabled = true;
            } else {
                loginBtn.classList.add('hidden');
                userInfo.classList.remove('hidden');
                userAvatar.src = data.avatar_url || 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png';
                userName.textContent = data.username;
                document.getElementById('submitBtn').disabled = false;
            }
        } catch (error) {
            console.error('Auth check failed:', error);
            loginBtn.classList.remove('hidden');
            userInfo.classList.add('hidden');
            this.showToast('Failed to check authentication status');
        }
    }

    setupEventListeners() {
        // Handle user dropdown menu
        const userAvatarWrapper = document.querySelector('.user-avatar-wrapper');
        const userDropdown = document.querySelector('.user-dropdown');
        const dropdownArrow = document.querySelector('.dropdown-arrow');

        userAvatarWrapper.addEventListener('click', (e) => {
            e.stopPropagation();
            userDropdown.classList.toggle('show');
            dropdownArrow.classList.toggle('rotated');
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!userDropdown.contains(e.target) && !userAvatarWrapper.contains(e.target)) {
                userDropdown.classList.remove('show');
                dropdownArrow.classList.remove('rotated');
            }
        });

        // Add logout handler
        document.getElementById('logoutButton').addEventListener('click', () => {
            fetch('/auth/logout', { credentials: 'include' })
                .then(() => {
                    this.checkAuthStatus();
                    window.location.reload();
                })
                .catch(error => {
                    console.error('Logout failed:', error);
                    this.showToast('Failed to logout');
                });
        });

        // Cache form elements
        this.formElements = {
            boardName: document.getElementById('boardName'),
            description: document.getElementById('description'),
            productLink: document.getElementById('productLink')
        };

        // Add validation on blur for text inputs
        this.formElements.boardName.addEventListener('blur', () => this.validateBoardName(this.formElements.boardName));
        this.formElements.boardName.addEventListener('paste', () => setTimeout(() => this.validateBoardName(this.formElements.boardName), 0));

        this.formElements.description.addEventListener('blur', () => this.validateDescription(this.formElements.description));
        this.formElements.description.addEventListener('paste', () => setTimeout(() => this.validateDescription(this.formElements.description), 0));

        this.formElements.productLink.addEventListener('blur', () => this.validateProductLink(this.formElements.productLink));
        this.formElements.productLink.addEventListener('paste', () => setTimeout(() => this.validateProductLink(this.formElements.productLink), 0));

        // Add validation for YAML drop and paste
        this.yamlDropZone.addEventListener('drop', () => setTimeout(() => this.validateYaml(), 0));
        this.yamlEditor.on('paste', () => setTimeout(() => this.validateYaml(), 0));

        // Add validation for image drop and paste
        this.imageDropZone.addEventListener('drop', () => setTimeout(() => this.validateImages(), 0));
        this.imageInput.addEventListener('paste', () => setTimeout(() => this.validateImages(), 0));

        // Add validation for GPIO pins when changed
        this.gpioPinList.addEventListener('change', () => this.validateGpioPins());

        // Add validation for tags when added/removed
        this.tagInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ',') {
                event.preventDefault();
                const tag = this.tagInput.value.trim().replace(/,/g, '');
                if (tag) {
                    this.addTag(tag);
                    this.validateTags();
                }
            }
        });

        this.form.addEventListener('submit', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const isValid = this.validateForm(true);
            if (!isValid) {
                const firstError = this.form.querySelector('.form-group.error');
                if (firstError) {
                    firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    this.showToast('Please fill in all required fields');
                }
                return;
            }

            try {
                await this.handleSubmit();
            } catch (error) {
                this.showToast(error.message);
            }
        });

        this.chipTypeSelect.addEventListener('change', this.handleChipTypeChange.bind(this));
        this.setupDropZone(this.yamlDropZone, this.handleYamlDrop.bind(this));
        this.setupDropZone(this.imageDropZone, this.handleImageDrop.bind(this));
        this.imageInput.addEventListener('change', this.handleImageSelect.bind(this));
        this.tagInput.addEventListener('input', this.handleTagInput.bind(this));
        this.tagInput.addEventListener('keydown', this.handleTagKeydown.bind(this));
        this.slugInput.addEventListener('input', this.validateSlug.bind(this));
        
        // Handle click on image drop zone and preview area
        this.imageDropZone.addEventListener('click', (e) => {
            // Only trigger file input if clicking the overlay or empty space
            if (e.target === this.imageDropZone || e.target.classList.contains('drop-zone-overlay') || e.target.classList.contains('image-preview')) {
                this.imageInput.click();
            }
        });

        // Make preview images clickable to open in new tab
        this.imagePreview.addEventListener('click', (e) => {
            if (e.target.tagName === 'IMG') {
                window.open(e.target.src, '_blank');
            }
        });
        
        // Handle click on YAML drop zone
        this.yamlOverlay.addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.yaml,.yml';
            input.onchange = (e) => this.handleYamlSelect(e);
            input.click();
        });

        // Handle drop zone content state
        this.yamlDropZone.addEventListener('drop', () => {
            this.yamlDropZone.classList.add('has-content');
        });
        this.imageDropZone.addEventListener('drop', () => {
            this.imageDropZone.classList.add('has-content');
        });

        // Board name and slug generation
        const boardNameInput = document.getElementById('boardName');
        const slugInput = document.getElementById('slug');
        
        boardNameInput.addEventListener('input', () => {
            const boardName = boardNameInput.value;
            if (boardName) {
                slugInput.value = this.generateSlug(boardName);
            }
        });

        // Context menu for image drop zone
        this.imageDropZone.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.contextMenu.style.display = 'block';
            this.contextMenu.style.left = `${e.pageX}px`;
            this.contextMenu.style.top = `${e.pageY}px`;
        });

        // Hide context menu on click outside
        document.addEventListener('click', (e) => {
            if (!this.contextMenu.contains(e.target) && e.target !== this.imageDropZone) {
                this.contextMenu.style.display = 'none';
            }
        });

        // Handle paste from context menu
        this.contextMenu.querySelector('[data-action="paste"]').addEventListener('click', async () => {
            this.contextMenu.style.display = 'none';
            try {
                const text = await navigator.clipboard.readText();
                if (text) {
                    try {
                        const url = new URL(text);
                        await this.handleImageUrl(url.href);
                    } catch (e) {
                        this.showToast('Please paste a valid image URL');
                    }
                }
            } catch (e) {
                this.showToast('Unable to access clipboard');
            }
        });

        // Add GitHub login button handler
        document.getElementById('githubLogin').addEventListener('click', () => {
            window.location.href = this.serverConfig.authUrl;
        });
    }

    generateSlug(text) {
        return text
            .toLowerCase()
            .replace(/[^a-z0-9\-\s\.]/g, '') // Keep only letters, numbers, dots, hyphens, and spaces
            .replace(/\s+/g, '-')            // Replace spaces with hyphens
            .replace(/\-+/g, '-')            // Replace multiple hyphens with single hyphen
            .replace(/^\-+|\-+$/g, '');      // Remove leading/trailing hyphens
    }

    showToast(message, duration = 3000) {
        this.toast.textContent = message;
        this.toast.style.display = 'block';
        setTimeout(() => {
            this.toast.style.display = 'none';
        }, duration);
    }

    handleTagInput(event) {
        const input = event.target.value.toLowerCase();
        if (input) {
            const suggestions = this.availableTags
                .filter(tag => tag.toLowerCase().includes(input) && !this.selectedTagsList.has(tag));
            
            if (suggestions.length > 0) {
                this.tagSuggestions.innerHTML = suggestions
                    .map(tag => `<div class="tag-suggestion-item" data-tag="${tag}">${tag}</div>`)
                    .join('');
                this.tagSuggestions.style.display = 'block';
                
                // Add click handlers to suggestions
                this.tagSuggestions.querySelectorAll('.tag-suggestion-item').forEach(item => {
                    item.addEventListener('click', () => this.addTag(item.dataset.tag));
                });
            } else {
                this.tagSuggestions.style.display = 'none';
            }
        } else {
            this.tagSuggestions.style.display = 'none';
        }
    }

    handleTagKeydown(event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            const firstSuggestion = this.tagSuggestions.querySelector('.tag-suggestion-item');
            if (firstSuggestion) {
                this.addTag(firstSuggestion.dataset.tag);
            }
        }
    }

    setupDropZone(dropZone, dropHandler) {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, preventDefaults, false);
        });

        function preventDefaults(e) {
            e.preventDefault();
            e.stopPropagation();
        }

        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => {
                dropZone.classList.add('drag-over');
            });
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => {
                dropZone.classList.remove('drag-over');
            });
        });

        dropZone.addEventListener('drop', dropHandler);
    }

    handleChipTypeChange(event) {
        const chipType = event.target.value;
        this.updateGpioPinList(chipType);
    }

    async handleYamlDrop(e) {
        const file = e.dataTransfer.files[0];
        if (file && (file.name.endsWith('.yaml') || file.name.endsWith('.yml'))) {
            await this.readYamlFile(file);
        } else {
            alert('Please drop a valid YAML file (.yaml or .yml)');
        }
    }

    async handleYamlSelect(e) {
        const file = e.target.files[0];
        if (file) {
            await this.readYamlFile(file);
        }
    }

    handleImageSelect(e) {
        const files = Array.from(e.target.files).filter(file => 
            file.type.startsWith('image/')
        );
        this.handleImageFiles(files);
    }

    addTag(tag) {
        if (!this.selectedTagsList.has(tag)) {
            this.selectedTagsList.add(tag);
            const tagElement = document.createElement('div');
            tagElement.className = 'tag';
            tagElement.innerHTML = `
                ${tag}
                <span class="tag-remove" data-tag="${tag}">&times;</span>
            `;
            
            tagElement.querySelector('.tag-remove').addEventListener('click', () => this.removeTag(tag));
            this.selectedTags.appendChild(tagElement);
            this.tagInput.value = '';
            this.tagSuggestions.style.display = 'none';

            this.validationState.hasTags = this.selectedTagsList.size > 0;
            document.getElementById('tagsRequired').value = this.validationState.hasTags ? 'valid' : '';
            this.validateForm();
        }
    }

    removeTag(tag) {
        this.selectedTagsList.delete(tag);
        const tagElement = this.selectedTags.querySelector(`[data-tag="${tag}"]`).parentElement;
        tagElement.remove();

        this.validationState.hasTags = this.selectedTagsList.size > 0;
        document.getElementById('tagsRequired').value = this.validationState.hasTags ? 'valid' : '';
        this.validateForm();
    }

    updateGpioPinList(chipType) {
        this.gpioPinList.innerHTML = '';
        
        if (!chipType) {
            this.gpioPinList.innerHTML = '<p class="select-chip-message">Please select a chip type to view available pins</p>';
            return;
        }

        const pins = this.chipPins[chipType] || [];
        pins.forEach(pin => {
            const pinItem = document.createElement('div');
            pinItem.className = 'gpio-pin-item';
            pinItem.innerHTML = `
                <span class="pin-number">${pin}</span>
                <input type="text" class="pin-function" placeholder="Enter pin function" data-pin="${pin}">
            `;

            const input = pinItem.querySelector('input');
            input.addEventListener('input', () => {
                this.validationState.hasGpioPins = Array.from(this.gpioPinList.querySelectorAll('.pin-function'))
                    .some(input => input.value.trim() !== '');
                document.getElementById('gpioPinsRequired').value = this.validationState.hasGpioPins ? 'valid' : '';
            });

            this.gpioPinList.appendChild(pinItem);
        });

        // Add grid layout styles
        this.gpioPinList.style.display = 'grid';
        this.gpioPinList.style.gridTemplateColumns = 'repeat(auto-fill, minmax(200px, 1fr))';
        this.gpioPinList.style.gap = '10px';
    }

    async readYamlFile(file) {
        try {
            const content = await file.text();
            this.yamlEditor.setValue(content);
            this.validateForm();
        } catch (error) {
            console.error('Error reading YAML file:', error);
            alert('Error reading YAML file. Please try again.');
        }
    }

    async handleSubmit() {
        try {
            const formData = new FormData();

            // Add basic form fields
            formData.append('slug', this.slugInput.value);
            formData.append('boardName', document.getElementById('boardName').value);
            formData.append('description', document.getElementById('description').value);
            formData.append('chipType', this.chipTypeSelect.value);

            // Add product link if provided
            const productLink = document.getElementById('productLink').value;
            if (productLink) {
                formData.append('productLink', productLink);
            }

            // Add GPIO pins
            const gpioPins = {};
            this.gpioPinList.querySelectorAll('.pin-function').forEach(input => {
                if (input.value.trim()) {
                    gpioPins[input.dataset.pin] = input.value.trim();
                }
            });
            formData.append('gpioPins', JSON.stringify(gpioPins));

            // Add tags
            const tags = Array.from(this.selectedTagsList).join(',');
            formData.append('tags', tags);

            // Add YAML configuration
            formData.append('yamlConfig', this.yamlEditor.getValue());

            // Add images
            const imageContainers = this.imagePreview.querySelectorAll('.image-container');
            for (let i = 0; i < imageContainers.length; i++) {
                const img = imageContainers[i].querySelector('img');
                const response = await fetch(img.src);
                const blob = await response.blob();
                
                // Validate image size
                if (blob.size > this.serverConfig.maxImageSize) {
                    throw new Error(`Image ${i + 1} exceeds maximum size of 5MB`);
                }
                
                formData.append(`image${i}`, blob, `image${i}.${blob.type.split('/')[1]}`);
            }

            // Submit the form
            const response = await fetch(this.serverConfig.submitUrl, {
                method: 'POST',
                body: formData,
                credentials: 'include'
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Submission failed');
            }

            const result = await response.json();
            this.showToast('Device configuration submitted successfully!');
            
            // Open PR in new tab if available
            if (result.pr_url) {
                window.open(result.pr_url, '_blank');
            }
            
            // Clear form after successful submission
            this.form.reset();
            this.imagePreview.innerHTML = '';
            this.yamlEditor.setValue('');
            this.selectedTagsList.clear();
            this.updateTagsDisplay();
            this.validationState = {
                hasTags: false,
                hasGpioPins: false,
                hasImages: false,
            };
        } catch (error) {
            if (error.message.includes('Authentication required')) {
                window.location.href = this.serverConfig.authUrl;
                return;
            }
            this.showToast(`Error: ${error.message}`);
            console.error('Submission error:', error);
        }
    }

    async handleImageDrop(e) {
        e.preventDefault();
        
        // Handle URLs
        const text = e.dataTransfer.getData('text');
        if (text) {
            try {
                const url = new URL(text);
                await this.handleImageUrl(url.href);
                return;
            } catch (e) {
                // Not a valid URL, continue with file handling
            }
        }

        // Handle files
        const files = Array.from(e.dataTransfer.files).filter(file => 
            file.type.startsWith('image/')
        );
        
        if (files.length > 0) {
            this.handleImageFiles(files);
        } else {
            alert('Please drop valid image files or image URLs');
        }
    }

    async handleImageUrl(url) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error('Failed to fetch image');
            
            const blob = await response.blob();
            if (!blob.type.startsWith('image/')) {
                throw new Error('URL does not point to an image');
            }

            await this.handleImageFiles([blob]);
            this.updateImageValidation();
        } catch (error) {
            alert('Failed to load image from URL: ' + error.message);
        }
    }

    handleImageFiles(files) {
        const promises = Array.from(files).map(file => {
            return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const img = document.createElement('img');
                    img.src = e.target.result;
                    img.className = 'preview-image';
                    
                    const container = document.createElement('div');
                    container.className = 'image-container';
                    container.appendChild(img);
                    
                    const removeBtn = document.createElement('button');
                    removeBtn.className = 'remove-image';
                    removeBtn.innerHTML = '×';
                    removeBtn.onclick = () => {
                        container.remove();
                        this.updateImageValidation();
                    };
                    
                    container.appendChild(removeBtn);
                    this.imagePreview.appendChild(container);
                    resolve();
                };
                reader.readAsDataURL(file);
            });
        });

        Promise.all(promises).then(() => {
            this.updateImageValidation();
        });
    }

    updateImageValidation() {
        const hasImages = this.imagePreview.children.length > 0;
        this.validationState.hasImages = hasImages;
        
        // Update validation UI
        const formGroup = this.imageDropZone.closest('.form-group');
        if (hasImages) {
            formGroup.classList.remove('error');
            formGroup.querySelector('.error-message').textContent = '';
            this.imageOverlay.style.display = 'none';
        }
        
        // Update hidden required field
        document.getElementById('imagesRequired').value = hasImages ? 'valid' : '';
    }

    validateUrl(input) {
        try {
            new URL(input);
            return true;
        } catch (e) {
            return false;
        }
    }

    validateSlug(event) {
        const input = event.target;
        const value = input.value;
        const sanitized = value.toLowerCase().replace(/[^a-z0-9-.]/, '');
        
        if (value !== sanitized) {
            input.value = sanitized;
        }
    }

    validateBoardName(field) {
        const formGroup = field.closest('.form-group');
        const errorElement = formGroup.querySelector('.error-message');
        
        if (!field.value.trim()) {
            formGroup.classList.add('error');
            errorElement.textContent = 'Board name is required';
            return false;
        }
        
        formGroup.classList.remove('error');
        errorElement.textContent = '';
        return true;
    }

    validateDescription(field) {
        const formGroup = field.closest('.form-group');
        const errorElement = formGroup.querySelector('.error-message');
        
        if (!field.value.trim()) {
            formGroup.classList.add('error');
            errorElement.textContent = 'Description is required';
            return false;
        }
        
        formGroup.classList.remove('error');
        errorElement.textContent = '';
        return true;
    }

    validateProductLink(field) {
        const formGroup = field.closest('.form-group');
        const errorElement = formGroup.querySelector('.error-message');
        const value = field.value.trim();
        
        if (value && !this.validateUrl(value)) {
            formGroup.classList.add('error');
            errorElement.textContent = 'Please enter a valid URL';
            return false;
        }
        
        formGroup.classList.remove('error');
        errorElement.textContent = '';
        return true;
    }

    validateGpioPins() {
        const formGroup = document.querySelector('#gpioPinList').closest('.form-group');
        const errorElement = formGroup.querySelector('.error-message');
        
        if (!this.validationState.hasGpioPins) {
            formGroup.classList.add('error');
            errorElement.textContent = 'At least one GPIO pin must have a function';
            return false;
        }
        
        formGroup.classList.remove('error');
        errorElement.textContent = '';
        return true;
    }

    validateTags() {
        const formGroup = document.querySelector('.tags-container').closest('.form-group');
        const errorElement = formGroup.querySelector('.error-message');
        
        if (!this.validationState.hasTags) {
            formGroup.classList.add('error');
            errorElement.textContent = 'At least one tag is required';
            return false;
        }
        
        formGroup.classList.remove('error');
        errorElement.textContent = '';
        return true;
    }

    validateImages() {
        const formGroup = this.imageDropZone.closest('.form-group');
        const errorElement = formGroup.querySelector('.error-message');
        
        if (!this.validationState.hasImages) {
            formGroup.classList.add('error');
            errorElement.textContent = 'At least one image is required';
            return false;
        }
        
        formGroup.classList.remove('error');
        errorElement.textContent = '';
        return true;
    }

    validateYaml() {
        const formGroup = this.yamlDropZone.closest('.form-group');
        const errorElement = formGroup.querySelector('.error-message');
        
        if (!this.yamlEditor.getValue().trim()) {
            formGroup.classList.add('error');
            errorElement.textContent = 'Sample YAML configuration is required';
            return false;
        }
        
        formGroup.classList.remove('error');
        errorElement.textContent = '';
        return true;
    }

    validateForm(always=false) {
        if (this.validationState.wasValidated || always)
            this.validationState.wasValidated = true;
        else
            return;
        // Add validate class to all form groups to show errors
        this.form.querySelectorAll('.form-group').forEach(group => {
            group.classList.add('validate');
        });

        return (
            this.validateBoardName(this.formElements.boardName) &
            this.validateDescription(this.formElements.description) &
            this.validateProductLink(this.formElements.productLink) &
            this.validateGpioPins() &
            this.validateTags() &
            this.validateImages() &
            this.validateYaml()
        );
    }
}

// Initialize the app
document.addEventListener('DOMContentLoaded', () => {
    new DeviceEditor();
});
