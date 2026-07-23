// АВТОГЕНЕРАЦИЯ — не править руками. Источник: scripts/prepare-assets.mjs.
// Перегенерировать: npm run assets. Свежесть стережёт тест test/assets.js.
//
// id → пути к webp. Предмет: { card, thumb }. Фишка: { chip, chipSmall }.
// id из ITEMS/HAZARDS без ассета — в MISSING: им остаётся текстовый фолбэк.

import i_blue_card_card from './items/blue_card.webp';
import i_blue_card_thumb from './items/blue_card.thumb.webp';
import i_id_badge_card from './items/id_badge.webp';
import i_id_badge_thumb from './items/id_badge.thumb.webp';
import i_axe_card from './items/axe.webp';
import i_axe_thumb from './items/axe.thumb.webp';
import i_chipItem_card from './items/chipItem.webp';
import i_chipItem_thumb from './items/chipItem.thumb.webp';
import i_toolbox_card from './items/toolbox.webp';
import i_toolbox_thumb from './items/toolbox.thumb.webp';
import i_helmet_card from './items/helmet.webp';
import i_helmet_thumb from './items/helmet.thumb.webp';
import i_lens_card from './items/lens.webp';
import i_lens_thumb from './items/lens.thumb.webp';
import i_stims_card from './items/stims.webp';
import i_stims_thumb from './items/stims.thumb.webp';
import i_drone_card from './items/drone.webp';
import i_drone_thumb from './items/drone.thumb.webp';
import i_medkit_card from './items/medkit.webp';
import i_medkit_thumb from './items/medkit.thumb.webp';
import i_extinguisher_card from './items/extinguisher.webp';
import i_extinguisher_thumb from './items/extinguisher.thumb.webp';
import i_battery_card from './items/battery.webp';
import i_battery_thumb from './items/battery.thumb.webp';
import i_teddy_card from './items/teddy.webp';
import i_teddy_thumb from './items/teddy.thumb.webp';
import i_parts_card from './items/parts.webp';
import i_parts_thumb from './items/parts.thumb.webp';
import i_suit_card from './items/suit.webp';
import i_suit_thumb from './items/suit.thumb.webp';
import i_flashlight_card from './items/flashlight.webp';
import i_flashlight_thumb from './items/flashlight.thumb.webp';
import h_fire_chip from './hazards/fire.webp';
import h_fire_small from './hazards/fire.small.webp';
import h_hypoxia_chip from './hazards/hypoxia.webp';
import h_hypoxia_small from './hazards/hypoxia.small.webp';
import h_darkness_chip from './hazards/darkness.webp';
import h_darkness_small from './hazards/darkness.small.webp';
import h_lockdown_chip from './hazards/lockdown.webp';
import h_lockdown_small from './hazards/lockdown.small.webp';
import h_spy_chip from './hazards/spy.webp';
import h_spy_small from './hazards/spy.small.webp';
import h_door_chip from './hazards/door.webp';
import h_door_small from './hazards/door.small.webp';

export const ITEM_ART = {
  blue_card: { card: i_blue_card_card, thumb: i_blue_card_thumb },
  id_badge: { card: i_id_badge_card, thumb: i_id_badge_thumb },
  axe: { card: i_axe_card, thumb: i_axe_thumb },
  chipItem: { card: i_chipItem_card, thumb: i_chipItem_thumb },
  toolbox: { card: i_toolbox_card, thumb: i_toolbox_thumb },
  helmet: { card: i_helmet_card, thumb: i_helmet_thumb },
  lens: { card: i_lens_card, thumb: i_lens_thumb },
  stims: { card: i_stims_card, thumb: i_stims_thumb },
  drone: { card: i_drone_card, thumb: i_drone_thumb },
  medkit: { card: i_medkit_card, thumb: i_medkit_thumb },
  extinguisher: { card: i_extinguisher_card, thumb: i_extinguisher_thumb },
  battery: { card: i_battery_card, thumb: i_battery_thumb },
  teddy: { card: i_teddy_card, thumb: i_teddy_thumb },
  parts: { card: i_parts_card, thumb: i_parts_thumb },
  suit: { card: i_suit_card, thumb: i_suit_thumb },
  flashlight: { card: i_flashlight_card, thumb: i_flashlight_thumb },
};

export const CHIP_ART = {
  fire: { chip: h_fire_chip, chipSmall: h_fire_small },
  hypoxia: { chip: h_hypoxia_chip, chipSmall: h_hypoxia_small },
  darkness: { chip: h_darkness_chip, chipSmall: h_darkness_small },
  lockdown: { chip: h_lockdown_chip, chipSmall: h_lockdown_small },
  spy: { chip: h_spy_chip, chipSmall: h_spy_small },
  door: { chip: h_door_chip, chipSmall: h_door_small },
};

export const ASSET_SIZES = {"card":360,"thumb":96,"chip":96,"chipSmall":56};
export const MISSING = {"items":[],"hazards":[]};
