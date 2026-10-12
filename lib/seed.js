// Sample library so the prototype has something to show on first run.
const T = (...tags) => tags.map((t) => ({ t, w: 1 }));
const hour = 3600e3;
const now = Date.now();

export const SEED = {
  version: 1,
  nextNo: 5,
  inbox: [
    {
      id: "in_1", kind: "text", source: "reddit.com", createdAt: now - 2 * hour,
      text: "chromatic aberration, film grain, faded colors, 1990s (style)"
    },
    {
      id: "in_2", kind: "booru", source: "danbooru.donmai.us", createdAt: now - 5 * hour,
      title: "frieren (sousou no frieren)",
      groups: {
        artist: [], copyright: ["sousou no frieren"], character: ["frieren"],
        general: ["1girl", "elf", "pointy ears", "white hair", "twintails", "green eyes", "white capelet", "earrings"], meta: []
      }
    },
    {
      id: "in_3", kind: "text", source: "address bar", createdAt: now - 26 * hour,
      text: "idea: knight asleep in a field of giant poppies, overcast, armor rusted and overgrown"
    }
  ],
  characters: [
    {
      id: "chr_rin", name: "Rin Aozora", series: "Original", trigger: "rin_aozora",
      lora: { name: "rin_aozora_v2.safetensors", w: 0.8 },
      appearance: ["1girl", "silver hair", "long hair", "twin braids", "red eyes", "freckles"],
      prose: "a young woman with long silver hair in twin braids, red eyes and light freckles",
      outfits: {
        street: { tags: ["oversized hoodie", "black shorts", "high-top sneakers"], prose: "wearing an oversized hoodie, black shorts and high-top sneakers" },
        battle: { tags: ["armored coat", "fingerless gloves", "katana"], prose: "in a long armored coat and fingerless gloves, a katana at her hip" }
      },
      notes: "LoRA holds the face best at 0.7 to 0.85 on Illustrious v1."
    },
    {
      id: "chr_vale", name: "Captain Vale", series: "Original", trigger: "",
      lora: null,
      appearance: ["1boy", "mature male", "short black hair", "stubble", "scar across eye", "grey eyes"],
      prose: "a weathered man in his forties with short black hair, stubble, grey eyes and a scar across one eye",
      outfits: {
        captain: { tags: ["naval coat", "epaulettes", "tricorne"], prose: "wearing a salt-stained naval coat with epaulettes and a tricorne" }
      },
      notes: ""
    },
    {
      id: "chr_miku", name: "Hatsune Miku", series: "Vocaloid", trigger: "hatsune miku",
      lora: null,
      appearance: ["1girl", "aqua hair", "very long hair", "twintails", "aqua eyes"],
      prose: "Hatsune Miku, with very long aqua twintails and aqua eyes",
      outfits: {
        default: { tags: ["detached sleeves", "necktie", "pleated skirt", "thighhighs"], prose: "in her grey sleeveless top, aqua necktie, detached sleeves and pleated skirt" }
      },
      notes: "Booru knows her; no LoRA needed on Illustrious."
    }
  ],
  recipes: [
    {
      id: "rec_1", no: 1, title: "Rainy neon alley", profile: "illustrious", fav: true, createdAt: now - 3 * 24 * hour,
      blocks: [
        { type: "character", ref: "chr_rin", outfit: "street" },
        { type: "pose", tags: T("looking back", "hands in pockets", "walking"), prose: "she glances back over her shoulder while walking, hands in her pockets" },
        { type: "scene", tags: T("night", "city", "alley", "neon lights", "rain", "wet street", "reflection"), prose: "a narrow city alley at night in the rain, neon signs reflecting off the wet street" },
        { type: "lighting", tags: [{ t: "backlighting", w: 1.2 }, ...T("rim light")], prose: "strong backlight and a pink rim light" },
        { type: "camera", tags: T("from behind", "cowboy shot", "depth of field"), prose: "" }
      ],
      negative: "",
      settings: { model: "illustriousXL_v10.safetensors", loras: [{ name: "rin_aozora_v2.safetensors", w: 0.8 }], sampler: "euler_ancestral", scheduler: "normal", steps: 28, cfg: 5, seed: 918273645, width: 832, height: 1216 }
    },
    {
      id: "rec_2", no: 2, title: "Greenhouse morning", profile: "krea", fav: false, createdAt: now - 2 * 24 * hour,
      blocks: [
        { type: "subject", tags: T("old botanist", "watering can"), prose: "An elderly botanist in a linen apron tends to a row of seedlings with a brass watering can" },
        { type: "scene", tags: T("greenhouse", "ferns", "condensation"), prose: "inside a Victorian glass greenhouse crowded with ferns, condensation beading on the panes" },
        { type: "lighting", tags: T("morning light", "volumetric light"), prose: "soft early-morning sun falls through the glass in visible shafts" },
        { type: "style", tags: T("35mm film", "kodak portra"), prose: "shot on 35mm film with the warm colours of Kodak Portra" }
      ],
      negative: "",
      settings: { model: "flux1-krea-dev.safetensors", loras: [], sampler: "euler", scheduler: "simple", steps: 28, cfg: 1, seed: 44102, width: 1024, height: 1024 }
    },
    {
      id: "rec_3", no: 3, title: "Hand-painted shop sign", profile: "qwen", fav: false, createdAt: now - 30 * hour,
      blocks: [
        { type: "subject", tags: T("wooden sign", "shop front"), prose: "A hand-painted wooden shop sign that reads \"PROMPTO · INK & PAPER\" in gold serif lettering" },
        { type: "scene", tags: T("cobblestone street", "flower boxes"), prose: "hanging above a narrow cobblestone street with red geraniums in the window boxes" },
        { type: "lighting", tags: T("overcast", "soft light"), prose: "" }
      ],
      negative: "",
      settings: { model: "qwen_image_fp8.safetensors", loras: [], sampler: "euler", scheduler: "simple", steps: 40, cfg: 4, seed: 7, width: 1328, height: 1328 }
    },
    {
      id: "rec_4", no: 4, title: "Deck of the Gull", profile: "anima", fav: false, createdAt: now - 8 * hour,
      blocks: [
        { type: "character", ref: "chr_vale", outfit: "captain" },
        { type: "pose", tags: T("standing", "hand on hip", "looking at viewer"), prose: "he stands with one hand on his hip, staring straight at the viewer" },
        { type: "scene", tags: T("ship deck", "stormy sky", "ocean spray"), prose: "on the deck of a ship under a stormy sky, spray coming over the rail" }
      ],
      negative: "",
      settings: { model: "anima_preview.safetensors", loras: [], sampler: "er_sde", scheduler: "simple", steps: 30, cfg: 4.5, seed: 31337, width: 896, height: 1152 }
    }
  ],
  snippets: [
    { id: "sn_1", cat: "Lighting", name: "Golden hour", tags: ["golden hour", "warm lighting", "lens flare", "long shadows"], prose: "lit by low golden-hour sun with long shadows and a soft lens flare" },
    { id: "sn_2", cat: "Lighting", name: "Moody rim", tags: ["rim light", "dark background", "high contrast"], prose: "a dark background with a hard rim light tracing the silhouette" },
    { id: "sn_3", cat: "Camera", name: "Heroic low angle", tags: ["from below", "dutch angle", "wide shot"], prose: "a wide, tilted shot looking up from a low angle" },
    { id: "sn_4", cat: "Style", name: "Painterly", tags: ["painterly", "impasto", "visible brush strokes", "traditional media"], prose: "painted in thick impasto with visible brush strokes" },
    { id: "sn_5", cat: "Style", name: "Analog film", tags: ["film grain", "chromatic aberration", "faded colors"], prose: "with heavy film grain, faded colours and slight chromatic aberration" },
    { id: "sn_6", cat: "Negative", name: "Hands fix", tags: ["bad hands", "extra digits", "fewer digits", "fused fingers"], prose: "" },
    { id: "sn_7", cat: "Wildcards", name: "Hair color", tags: ["silver hair", "black hair", "red hair", "blonde hair", "pink hair"], prose: "" }
  ]
};
