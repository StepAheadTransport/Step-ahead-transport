document.getElementById('year').textContent = new Date().getFullYear();

const form = document.getElementById('bookingForm');
const serviceSelect = document.getElementById('service');
const moveDate = document.getElementById('moveDate');
const itemsField = form.querySelector('textarea[name="items"]');
const photosInput = document.getElementById('photos');
const photoPreview = document.getElementById('photoPreview');
const estimateValue = document.getElementById('estimateValue');
const estimateNote = document.getElementById('estimateNote');

const today = new Date();
today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
moveDate.min = today.toISOString().slice(0, 10);

document.querySelectorAll('[data-service]').forEach(link => {
  link.addEventListener('click', () => {
    serviceSelect.value = link.dataset.service;
    updateEstimate();
  });
});

document.querySelectorAll('[data-item]').forEach(button => {
  button.addEventListener('click', () => {
    const item = button.dataset.item;
    const current = itemsField.value.trim();

    // Quick-add buttons are intentionally repeatable. Every tap adds another
    // occurrence so customers can build up their item list quickly, e.g.
    // "Bed, Bed, Couch" instead of being limited to one of each item.
    itemsField.value = current ? `${current}, ${item}` : item;
    itemsField.focus();
    updateEstimate();
  });
});

photosInput.addEventListener('change', () => {
  photoPreview.innerHTML = '';
  const files = Array.from(photosInput.files || []);
  files.slice(0, 4).forEach(file => {
    const card = document.createElement('div');
    card.className = 'preview-card';
    const image = document.createElement('img');
    image.alt = 'Selected item photo';
    image.src = URL.createObjectURL(file);
    image.onload = () => URL.revokeObjectURL(image.src);
    card.appendChild(image);
    photoPreview.appendChild(card);
  });
  if (files.length > 4) {
    const more = document.createElement('div');
    more.className = 'preview-more';
    more.textContent = `+${files.length - 4} more`;
    photoPreview.appendChild(more);
  }
  updateEstimate();
});

// Starter broad-estimate engine. These are deliberately conservative launch rules and
// will be replaced/refined with Step Ahead's real pricing data and route calculations.
function updateEstimate() {
  const service = serviceSelect.value;
  const moveSize = form.elements.moveSize.value;
  const pickupAccess = form.elements.pickupAccess.value;
  const dropoffAccess = form.elements.dropoffAccess.value;
  const items = (itemsField.value || '').toLowerCase();

  if (!service || !moveSize) {
    estimateValue.textContent = 'Complete the move details to see an estimate';
    estimateNote.textContent = 'This is a guide only. Your final quote will be confirmed by Step Ahead Transport after reviewing your booking details, route and photos.';
    return null;
  }

  let base = service === 'House Moving' ? 650 : service === 'Furniture Delivery' ? 500 : service === 'General Transport' ? 550 : 600;
  const sizeAdd = {
    'Single / a few items': 0,
    'Small load': 200,
    '1 bedroom': 500,
    '2 bedroom': 900,
    '3+ bedroom / large move': 1500,
    'Not sure': 450
  }[moveSize] || 0;
  base += sizeAdd;

  const difficultAccess = [pickupAccess, dropoffAccess].filter(v => v === 'Stairs' || v === 'Lift / apartment').length;
  base += difficultAccess * 150;
  if (/double-door|double door|piano|safe|large wardrobe|pool table/.test(items)) base += 250;
  if (/trailer/.test(items)) base += 150;

  // Broad range: wider where the information is less certain.
  const uncertainty = moveSize === 'Not sure' || !items.trim() ? 0.30 : 0.22;
  const low = Math.max(350, Math.round((base * (1 - uncertainty)) / 50) * 50);
  const high = Math.round((base * (1 + uncertainty)) / 50) * 50;

  estimateValue.textContent = `R${low.toLocaleString('en-ZA')} – R${high.toLocaleString('en-ZA')}`;
  estimateNote.textContent = 'Broad estimate only. It is not your final quotation and may change after Step Ahead reviews the route, distance, items, access requirements and photos.';
  return { low, high };
}

['change','input'].forEach(eventName => form.addEventListener(eventName, updateEstimate));

form.addEventListener('submit', event => {
  event.preventDefault();
  if (!form.reportValidity()) return;

  const estimate = updateEstimate();
  const data = new FormData(form);
  const lines = [
    'Hi Step Ahead Transport 👋 I\'ve just submitted my booking request through the Step Ahead website.',
    '',
    '*BOOKING SUMMARY*',
    `Service: ${data.get('service')}`,
    `Preferred date: ${data.get('moveDate')}`,
    `Move size: ${data.get('moveSize')}`,
  ];
  if (estimate) lines.push(`Broad website estimate: R${estimate.low.toLocaleString('en-ZA')} – R${estimate.high.toLocaleString('en-ZA')}`);
  lines.push('', 'Please review my booking details and confirm the final quote.');

  // Temporary pre-Supabase behaviour: opens WhatsApp with a notification only.
  // Once Supabase is connected, this submit handler will save the booking and photos first,
  // then show a confirmation screen with this same optional WhatsApp notification.
  const url = `https://wa.me/27605503004?text=${encodeURIComponent(lines.join('\n'))}`;
  window.open(url, '_blank', 'noopener');
});  

/* -------------------------------------------------------
   Google Places autocomplete for Step Ahead addresses
   ------------------------------------------------------- */

const GOOGLE_MAPS_API_KEY = 'AIzaSyCyPGANwGYXHPhLpyq580kU0EQywL2949M';

async function loadGooglePlaces() {
  if (window.google?.maps?.importLibrary) {
    return;
  }

  await new Promise((resolve, reject) => {
    const script = document.createElement('script');

    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
        GOOGLE_MAPS_API_KEY
      )}&v=weekly&loading=async`;

    script.async = true;
    script.defer = true;

    script.onload = resolve;
    script.onerror = () =>
      reject(new Error('Google Maps could not be loaded.'));

    document.head.appendChild(script);
  });
}

async function setupAddressAutocomplete() {
  try {
    await loadGooglePlaces();

    const {
      AutocompleteSuggestion,
      AutocompleteSessionToken
    } = await google.maps.importLibrary('places');

    const addressFields = [
      document.getElementById('pickupAddress'),
      document.getElementById('dropoffAddress'),
    ].filter(Boolean);

    addressFields.forEach((input) => {
      let sessionToken = new AutocompleteSessionToken();
      let debounceTimer = null;
      let currentSuggestions = [];
      let activeIndex = -1;

      const dropdown = document.createElement('div');

      dropdown.className = 'google-address-suggestions';
      dropdown.style.position = 'absolute';
      dropdown.style.left = '0';
      dropdown.style.right = '0';
      dropdown.style.top = 'calc(100% + 6px)';
      dropdown.style.zIndex = '9999';
      dropdown.style.background = '#ffffff';
      dropdown.style.border = '1px solid #e5e7eb';
      dropdown.style.borderRadius = '14px';
      dropdown.style.boxShadow = '0 10px 30px rgba(0,0,0,0.12)';
      dropdown.style.overflow = 'hidden';
      dropdown.style.display = 'none';

      const fieldWrapper = input.parentElement;

      if (fieldWrapper) {
        fieldWrapper.style.position = 'relative';
        fieldWrapper.appendChild(dropdown);
      }

      function closeDropdown() {
        dropdown.innerHTML = '';
        dropdown.style.display = 'none';
        currentSuggestions = [];
        activeIndex = -1;
      }

      function renderSuggestions(suggestions) {
        dropdown.innerHTML = '';
        currentSuggestions = suggestions;
        activeIndex = -1;

        if (!suggestions.length) {
          closeDropdown();
          return;
        }

        suggestions.forEach((suggestion, index) => {
          const prediction = suggestion.placePrediction;
          if (!prediction) return;

          const button = document.createElement('button');

          button.type = 'button';
          button.style.display = 'block';
          button.style.width = '100%';
          button.style.border = '0';
          button.style.background = '#ffffff';
          button.style.padding = '14px 16px';
          button.style.textAlign = 'left';
          button.style.cursor = 'pointer';
          button.style.font = 'inherit';
          button.style.color = '#172033';

          const title = document.createElement('div');
          title.textContent = prediction.text.toString();
          title.style.fontWeight = '600';

          button.appendChild(title);

          button.addEventListener('mouseenter', () => {
            activeIndex = index;
            updateActiveItem();
          });

          button.addEventListener('click', async () => {
            await selectSuggestion(prediction);
          });

          dropdown.appendChild(button);
        });

        dropdown.style.display = 'block';
      }

      function updateActiveItem() {
        [...dropdown.children].forEach((item, index) => {
          item.style.background =
            index === activeIndex ? '#fff4e8' : '#ffffff';
        });
      }

      async function selectSuggestion(prediction) {
        try {
          const place = prediction.toPlace();

          await place.fetchFields({
            fields: ['formattedAddress', 'location'],
          });

          input.value =
            place.formattedAddress || prediction.text.toString();

          if (place.location) {
            input.dataset.lat = String(place.location.lat());
            input.dataset.lng = String(place.location.lng());
          }

          input.dataset.googlePlaceSelected = 'true';

          closeDropdown();

          sessionToken = new AutocompleteSessionToken();

          if (typeof updateEstimate === 'function') {
            updateEstimate();
          }
        } catch (error) {
          console.error('Google place selection failed:', error);
          closeDropdown();
        }
      }

      input.addEventListener('input', () => {
        input.dataset.googlePlaceSelected = 'false';
        delete input.dataset.lat;
        delete input.dataset.lng;

        clearTimeout(debounceTimer);

        const value = input.value.trim();

        if (value.length < 2) {
          closeDropdown();
          return;
        }

        debounceTimer = setTimeout(async () => {
          try {
            const request = {
              input: value,
              includedRegionCodes: ['za'],
              sessionToken,
            };

            const { suggestions } =
              await AutocompleteSuggestion.fetchAutocompleteSuggestions(
                request
              );

            if (input.value.trim() !== value) {
              return;
            }

            renderSuggestions(suggestions || []);
          } catch (error) {
            console.error('Google autocomplete failed:', error);
            closeDropdown();
          }
        }, 250);
      });

      input.addEventListener('keydown', async (event) => {
        const items = [...dropdown.children];

        if (dropdown.style.display === 'none' || !items.length) {
          return;
        }

        if (event.key === 'ArrowDown') {
          event.preventDefault();
          activeIndex = Math.min(activeIndex + 1, items.length - 1);
          updateActiveItem();
        }

        if (event.key === 'ArrowUp') {
          event.preventDefault();
          activeIndex = Math.max(activeIndex - 1, 0);
          updateActiveItem();
        }

        if (event.key === 'Enter' && activeIndex >= 0) {
          event.preventDefault();

          const prediction =
            currentSuggestions[activeIndex]?.placePrediction;

          if (prediction) {
            await selectSuggestion(prediction);
          }
        }

        if (event.key === 'Escape') {
          closeDropdown();
        }
      });

      document.addEventListener('click', (event) => {
        if (
          event.target !== input &&
          !dropdown.contains(event.target)
        ) {
          closeDropdown();
        }
      });
    });
  } catch (error) {
    console.error('Address autocomplete could not start:', error);
  }
}

setupAddressAutocomplete();
