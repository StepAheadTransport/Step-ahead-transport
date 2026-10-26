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
let estimateRunId = 0;
let routeRequestId = 0;
let lastRouteKey = "";
let lastRouteKm = null;

function getEstimateBreakdownElement() {
  let element = document.getElementById("estimateBreakdown");

  if (!element) {
    element = document.createElement("div");
    element.id = "estimateBreakdown";
    element.style.cssText =
      "display:grid;gap:9px;margin:14px 0;padding:15px;" +
      "border:1px solid #e5e7eb;border-radius:12px;" +
      "background:#fff;color:#222;font-size:14px;";

    estimateValue.insertAdjacentElement("afterend", element);
  }

  return element;
}

async function getDrivingDistanceKm(origin, destination) {
  const routeKey = `${origin.trim()}|||${destination.trim()}`;

  if (routeKey === lastRouteKey && lastRouteKm !== null) {
    return lastRouteKm;
  }

  const requestId = ++routeRequestId;

  // Debounce typing to reduce unnecessary route requests.
  await new Promise(resolve => setTimeout(resolve, 900));

  if (requestId !== routeRequestId) return null;

  try {
    if (!window.google?.maps?.importLibrary) return null;

    const { Route } = await window.google.maps.importLibrary("routes");

    const { routes } = await Route.computeRoutes({
      origin: origin.trim(),
      destination: destination.trim(),
      travelMode: "DRIVING",
      fields: ["distanceMeters"]
    });

    if (requestId !== routeRequestId) return null;

    const meters = routes?.[0]?.distanceMeters;

    if (typeof meters !== "number" || !Number.isFinite(meters)) {
      return null;
    }

    lastRouteKey = routeKey;
    lastRouteKm = Math.ceil(meters / 1000);

    return lastRouteKm;
  } catch (error) {
    console.error("Could not calculate driving distance:", error);
    return null;
  }
}

async function updateEstimate() {
  const runId = ++estimateRunId;
  const service = serviceSelect.value;
  const moveSize = form.elements.moveSize?.value || "";

  const isHouseMove = service === "House Moving";
  const isDelivery = service === "Furniture Delivery";

  const houseFields = document.getElementById("houseMovePricingFields");
  const deliveryFields = document.getElementById("deliveryPricingFields");
  const moveSizeLabel = form.elements.moveSize?.closest("label");
  const breakdown = document.getElementById("estimateBreakdown");

  if (houseFields) {
    houseFields.style.display = isHouseMove ? "grid" : "none";
  }

  if (deliveryFields) {
    deliveryFields.style.display = isDelivery ? "grid" : "none";
  }

  // Deliveries use the delivery item selector instead of bedroom/house size.
  if (moveSizeLabel) {
    moveSizeLabel.style.display = isDelivery ? "none" : "";
  }

  if (form.elements.moveSize) {
    form.elements.moveSize.required = !isDelivery;
  }

  if (!service || (!isDelivery && !moveSize)) {
    routeRequestId++;
    estimateValue.textContent = "Complete the move details to see an estimate";
    estimateNote.textContent =
      "Your final quotation will be confirmed by Step Ahead Transport.";
    if (breakdown) breakdown.innerHTML = "";
    return null;
  }

  const pickupAddress =
    document.getElementById("pickupAddress")?.value.trim() || "";
  const dropoffAddress =
    document.getElementById("dropoffAddress")?.value.trim() || "";

  if (!pickupAddress || !dropoffAddress) {
    routeRequestId++;
    estimateValue.textContent =
      "Add both addresses to calculate your estimate";
    estimateNote.textContent =
      "The distance charge is R17 per kilometre between collection and delivery.";
    if (breakdown) breakdown.innerHTML = "";
    return null;
  }

  estimateValue.textContent = "Calculating driving distance…";
  estimateNote.textContent =
    "Calculating the route between your collection and delivery addresses.";

  const distanceKm = await getDrivingDistanceKm(
    pickupAddress,
    dropoffAddress
  );

  // Ignore older calculations if the customer has changed their details.
  if (runId !== estimateRunId) return null;

  if (distanceKm === null) {
    estimateValue.textContent = "Distance could not be calculated";
    estimateNote.textContent =
      "Please check both addresses. If the problem continues, submit your details and we will review the route manually.";
    const existingBreakdown = document.getElementById("estimateBreakdown");
    if (existingBreakdown) existingBreakdown.innerHTML = "";
    return null;
  }

  const items = (itemsField.value || "").trim();
  const pickupAccess = form.elements.pickupAccess?.value || "";
  const dropoffAccess = form.elements.dropoffAccess?.value || "";

  let base = 0;
  let moversCharge = 0;
  let floorCharge = 0;
  let accessCharge = 0;
  let loadCharge = 0;

  if (isHouseMove) {
    const houseBasePrices = {
      "Single / a few items": 1250,
      "Small load": 1250,
      "1 bedroom": 1250,
      "2 bedroom": 1550,
      "3 bedroom": 2500,
      "4 bedroom": 5500,
      "3+ bedroom / large move": 2500,
      "Not sure": 2500
    };

    base = houseBasePrices[moveSize] ?? 2500;

    const movers = Number(form.elements.houseMovers?.value || 2);
    moversCharge = movers * 200;

    const pickupFloor = Number(form.elements.pickupFloor?.value || 0);
    const dropoffFloor = Number(form.elements.dropoffFloor?.value || 0);

    // R100 per floor at each affected property without a usable lift.
    floorCharge = (pickupFloor + dropoffFloor) * 100;

    // Restricted-access surcharge applies to house moves only.
    if (pickupAccess === "Complex / security access") {
      accessCharge += 250;
    }

    if (dropoffAccess === "Complex / security access") {
      accessCharge += 250;
    }
  } else if (isDelivery) {
    base = 500;

    const helpers = Number(form.elements.deliveryMovers?.value || 0);
    moversCharge = helpers * 200;

    const deliveryLoadSize =
      form.elements.deliveryLoadSize?.value || "single";

    const loadFees = {
      single: 0,
      twoThree: 100,
      fourFive: 200,
      sixPlus: 300
    };

    loadCharge = loadFees[deliveryLoadSize] ?? 0;
  } else {
    // Keep the existing starting prices for other transport services.
    base = service === "General Transport" ? 550 : 600;

    const sizeAdds = {
      "Single / a few items": 0,
      "Small load": 200,
      "1 bedroom": 500,
      "2 bedroom": 900,
      "3 bedroom": 1500,
      "4 bedroom": 1500,
      "3+ bedroom / large move": 1500,
      "Not sure": 450
    };

    base += sizeAdds[moveSize] ?? 0;
  }

  // Charge only the collection-to-delivery driving distance.
  const distanceCharge = distanceKm * 17;

  const subtotal =
    base +
    moversCharge +
    distanceCharge +
    floorCharge +
    accessCharge +
    loadCharge;

  const deliveryLoadSize =
    form.elements.deliveryLoadSize?.value || "single";

  const needsReview =
    moveSize === "Not sure" ||
    moveSize === "3+ bedroom / large move" ||
    service === "Other" ||
    deliveryLoadSize === "sixPlus" ||
    pickupAccess === "Other" ||
    dropoffAccess === "Other" ||
    !items;

  // Known details: 15% provisional allowance.
  // Uncertain or large jobs: 30% provisional allowance.
  const allowance = needsReview ? 1.30 : 1.15;
  const upper = Math.ceil((subtotal * allowance) / 50) * 50;

  const formatRand = amount =>
    `R${Math.round(amount).toLocaleString("en-ZA")}`;

  estimateValue.textContent =
    `${formatRand(subtotal)} – ${formatRand(upper)}`;

  const breakdownElement = getEstimateBreakdownElement();
  const rows = [
    ["Base price", base],
    [isDelivery ? "Loading assistance" : "Movers", moversCharge],
    [`Distance (${distanceKm} km × R17)`, distanceCharge]
  ];

  if (floorCharge > 0) {
    rows.push(["Floor-level surcharge", floorCharge]);
  }

  if (accessCharge > 0) {
    rows.push(["Restricted-access surcharge", accessCharge]);
  }

  if (loadCharge > 0) {
    rows.push(["Additional load-size charge", loadCharge]);
  }

  breakdownElement.innerHTML =
    `<div style="font-weight:700;color:#c76513;margin-bottom:3px">` +
    `Estimated price breakdown</div>` +
    rows.map(([label, amount]) =>
      `<div style="display:flex;justify-content:space-between;gap:16px">` +
      `<span>${label}</span><strong>${formatRand(amount)}</strong></div>`
    ).join("") +
    `<div style="display:flex;justify-content:space-between;gap:16px;` +
    `border-top:1px solid #e5e7eb;padding-top:10px;font-weight:700">` +
    `<span>Calculated subtotal</span><strong>${formatRand(subtotal)}</strong></div>`;

  estimateNote.textContent =
    `Preliminary estimate based on ${distanceKm} km of driving between ` +
    `collection and delivery. The return journey is not included. ` +
    `Your final quotation may change after we review your items, photos, ` +
    `access requirements and load size.`;

  return { low: subtotal, high: upper, distanceKm };
}
['change','input'].forEach(eventName => form.addEventListener(eventName, updateEstimate));
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!form.reportValidity()) return;

  const estimate = await updateEstimate();
  const data = new FormData(form);

  const lines = [
    "Hi Step Ahead Transport 👋 I've just submitted my booking request through the Step Ahead website.",
    "",
    "*BOOKING SUMMARY*",
    `Service: ${data.get('service')}`,
    `Preferred date: ${data.get('moveDate')}`,
    `Move size: ${data.get('moveSize') || 'Not applicable'}`,
    `Collection: ${data.get('pickupAddress')}`,
    `Delivery: ${data.get('dropoffAddress')}`,
    `Items: ${data.get('items') || 'Not specified'}`,
    `Name: ${data.get('name') || 'Not provided'}`,
    `Phone: ${data.get('phone') || 'Not provided'}`
  ];

  if (estimate) {
    lines.push(
      `Preliminary website estimate: R${estimate.low.toLocaleString('en-ZA')} – R${estimate.high.toLocaleString('en-ZA')}`
    );
  }

  lines.push(
    '',
    'Please review my booking details and confirm the final quotation.'
  );

  const url =
    `https://wa.me/27605503004?text=${encodeURIComponent(lines.join('\n'))}`;

  window.open(url, '_blank', 'noopener');
});
/* -------------------------------------------------------
   Google Places autocomplete for Step Ahead addresses
   ------------------------------------------------------- */

const GOOGLE_MAPS_API_KEY = 'AIzaSyCyPGANwGYXHPhLpyq580kU0EQywL2949M';

async function loadGooglePlaces() {
  if (!window.google?.maps?.importLibrary) {
    ((g) => {
      let h;
      const p = "The Google Maps JavaScript API";
      const c = "google";
      const l = "importLibrary";
      const q = "__ib__";
      const m = document;
      const b = window;

      b[c] = b[c] || {};
      const d = b[c].maps = b[c].maps || {};
      const r = new Set();
      const e = new URLSearchParams();

      const u = () => h || (h = new Promise(async (f, n) => {
        const a = m.createElement("script");
        e.set("libraries", [...r] + "");

        for (const k in g) {
          e.set(k.replace(/[A-Z]/g, t =>
            "_" + t[0].toLowerCase()
          ), g[k]);
        }

        e.set("callback", c + ".maps." + q);
        a.src = `https://maps.${c}apis.com/maps/api/js?` + e;
        d[q] = f;
        a.onerror = () => h = n(
          new Error(p + " could not load.")
        );
        a.nonce = m.querySelector("script[nonce]")?.nonce || "";
        m.head.append(a);
      }));

      if (d[l]) {
        console.warn(p + " only loads once. Ignoring:", g);
      } else {
        d[l] = (f, ...n) =>
          r.add(f) && u().then(() => d[l](f, ...n));
      }
    })({
      key: GOOGLE_MAPS_API_KEY,
      v: "weekly"
    });
  }

  await window.google.maps.importLibrary("places");
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
