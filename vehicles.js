// 2D vehicle illustrations shown while the site is loading.
// Each is drawn in a 220 x 90 box and rendered 2 inches wide.

const P = "#4e2a84";      // Kellogg purple
const P2 = "#6c4bb0";     // lighter purple
const P3 = "#b9a6dd";     // lavender
const INK = "#2a1f3d";
const GLASS = "#3b2a5c";

const wheel = (cx, cy, r = 11) => `
  <g>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${INK}"/>
    <circle cx="${cx}" cy="${cy}" r="${r * 0.55}" fill="#d9d4e3"/>
    <circle cx="${cx}" cy="${cy}" r="${r * 0.2}" fill="${INK}"/>
  </g>`;

const shadow = (x, w) => `<ellipse cx="${x}" cy="84" rx="${w}" ry="3.5" fill="${P}" opacity=".12"/>`;

export const VEHICLES = {
  trolley: {
    label: "Kellogg Trolley",
    svg: `
<svg viewBox="0 0 220 90" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Kellogg trolley">
  ${shadow(110, 92)}
  <!-- roof rail + cupola -->
  <rect x="34" y="8" width="150" height="5" rx="2.5" fill="${P3}"/>
  <rect x="40" y="13" width="140" height="6" rx="2" fill="#efeaf7"/>
  <!-- body -->
  <path d="M22 22 Q22 18 26 18 L190 18 Q200 18 203 28 L208 60 Q209 70 200 70 L24 70 Q20 70 20 66 Z" fill="#fff" stroke="${P}" stroke-width="2"/>
  <!-- windows -->
  ${[30, 50, 70, 90, 110, 130].map((x) => `<rect x="${x}" y="25" width="15" height="20" rx="5" fill="${GLASS}"/>`).join("")}
  <!-- door -->
  <rect x="152" y="25" width="20" height="40" rx="3" fill="#fff" stroke="${P}" stroke-width="1.6"/>
  <rect x="155" y="28" width="6" height="16" rx="2" fill="${GLASS}"/>
  <rect x="163" y="28" width="6" height="16" rx="2" fill="${GLASS}"/>
  <!-- front windshield -->
  <path d="M178 25 L192 25 Q197 26 198 33 L199 45 L178 45 Z" fill="${GLASS}"/>
  <!-- stripes + name -->
  <rect x="24" y="50" width="124" height="2" fill="${P}"/>
  <rect x="24" y="62" width="124" height="2" fill="${P}"/>
  <text x="86" y="60" text-anchor="middle" font-family="Georgia, serif" font-size="8.5" font-weight="700" fill="${P}">Kellogg Trolley</text>
  <!-- headlight + bumper -->
  <circle cx="202" cy="56" r="3.2" fill="#ffd66b" stroke="${P}" stroke-width="1"/>
  <rect x="18" y="68" width="190" height="4" rx="2" fill="${P3}"/>
  ${wheel(52, 74)} ${wheel(176, 74)}
</svg>`,
  },

  partybus: {
    label: "Kellogg Party Bus",
    svg: `
<svg viewBox="0 0 220 90" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Kellogg party bus">
  ${shadow(110, 96)}
  <!-- body -->
  <path d="M14 20 Q14 12 22 12 L176 12 Q196 12 204 26 L212 44 Q214 50 214 56 L214 66 Q214 72 208 72 L18 72 Q14 72 14 68 Z" fill="${P}"/>
  <!-- window band -->
  <path d="M20 18 L178 18 Q192 18 198 28 L204 40 L20 40 Z" fill="${GLASS}"/>
  <path d="M182 19 Q194 20 199 30 L205 41 L182 41 Z" fill="#5b4a80"/>
  <!-- white swoosh -->
  <path d="M14 58 Q70 40 130 50 Q170 57 214 46 L214 56 Q170 66 128 60 Q74 52 14 68 Z" fill="#fff"/>
  <path d="M14 64 Q70 48 128 56 Q170 62 214 52" fill="none" stroke="${P3}" stroke-width="1.4"/>
  <text x="96" y="35" text-anchor="middle" font-family="Georgia, serif" font-size="10" font-weight="700" fill="#fff" opacity=".95">Kellogg Party Bus</text>
  <!-- party lights on roof -->
  ${[40, 70, 100, 130, 160].map((x, i) => `<circle cx="${x}" cy="10" r="2.6" fill="${["#ffd66b", "#ff8ad1", "#8ae3ff", "#b6ff8a", "#ffd66b"][i]}"/>`).join("")}
  <!-- headlight + bumper -->
  <rect x="204" y="58" width="9" height="4" rx="2" fill="#ffd66b"/>
  <rect x="12" y="70" width="204" height="4" rx="2" fill="${INK}"/>
  ${wheel(50, 74, 11.5)} ${wheel(178, 74, 11.5)}
</svg>`,
  },

  sedan: {
    label: "Kellogg Sedan",
    svg: `
<svg viewBox="0 0 220 90" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Kellogg sedan">
  ${shadow(112, 90)}
  <!-- body -->
  <path d="M18 60 Q16 50 26 47 L60 42 Q80 24 104 22 L140 22 Q160 23 176 40 L200 45 Q212 48 212 58 L212 64 Q212 70 205 70 L24 70 Q18 70 18 64 Z" fill="#fff" stroke="${P}" stroke-width="1.8"/>
  <!-- windows -->
  <path d="M68 42 Q84 28 104 27 L118 27 L118 42 Z" fill="${GLASS}"/>
  <path d="M123 27 L140 27 Q156 28 168 41 L123 42 Z" fill="${GLASS}"/>
  <!-- purple swoosh -->
  <path d="M18 62 Q70 46 130 52 Q170 56 212 50 L212 56 Q170 62 130 58 Q74 54 20 68 Z" fill="${P}"/>
  <path d="M60 50 Q100 40 150 44" fill="none" stroke="${P2}" stroke-width="2.2" stroke-linecap="round"/>
  <!-- door K badge -->
  <text x="132" y="50" text-anchor="middle" font-family="Georgia, serif" font-size="11" font-weight="700" fill="${P}">K</text>
  <!-- lights -->
  <path d="M202 50 L211 52 L211 56 L203 55 Z" fill="#ffd66b"/>
  <rect x="17" y="52" width="5" height="5" rx="1.5" fill="#e0457b"/>
  ${wheel(56, 72, 11)} ${wheel(172, 72, 11)}
</svg>`,
  },
};

// Soft purple skyline for the background strip (generic city + glass campus building).
export const SKYLINE = `
<svg viewBox="0 0 1200 120" preserveAspectRatio="xMidYMax slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <g fill="${P3}" opacity=".45">
    <rect x="520" y="40" width="34" height="80"/><rect x="530" y="10" width="14" height="30"/><rect x="535" y="0" width="4" height="12"/>
    <rect x="470" y="62" width="40" height="58"/><rect x="560" y="55" width="30" height="65"/>
    <rect x="600" y="70" width="44" height="50"/><rect x="430" y="80" width="34" height="40"/>
    <rect x="650" y="48" width="26" height="72"/><rect x="380" y="90" width="44" height="30"/>
  </g>
  <g fill="${P3}" opacity=".7">
    <path d="M700 120 L700 78 Q760 56 860 64 L940 70 L940 120 Z"/>
    <path d="M880 120 L880 84 Q930 72 1000 80 L1000 120 Z"/>
  </g>
  <g fill="#fff" opacity=".55">
    ${Array.from({ length: 9 }, (_, i) => `<rect x="${712 + i * 24}" y="84" width="16" height="4" rx="1"/><rect x="${712 + i * 24}" y="96" width="16" height="4" rx="1"/>`).join("")}
  </g>
  <g fill="${P2}" opacity=".35">
    <circle cx="690" cy="110" r="9"/><circle cx="960" cy="108" r="10"/><circle cx="1010" cy="112" r="8"/><circle cx="360" cy="112" r="8"/>
  </g>
</svg>`;

const ORDER = ["trolley", "partybus", "sedan"];
let last = -1;
export function nextVehicle() {
  // Rotate randomly but never repeat the same vehicle twice in a row.
  let i;
  do { i = Math.floor(Math.random() * ORDER.length); } while (i === last && ORDER.length > 1);
  last = i;
  return VEHICLES[ORDER[i]];
}
