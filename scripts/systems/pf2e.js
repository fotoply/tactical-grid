import { GenericSystem } from './generic.js';
import { RangeHighlightAPI } from '../rangeHighlighter.js';

export default class PF2e extends GenericSystem {
  /** @override */
  static onInit() {
    super.onInit();
    this._registerActorSheetListeners();
    this._registerChatMessageListerners();
  }

  /** @override */
  static getItemFromMacro(macro, actor) {
    if (!macro) return null;
    let match;
    if (macro.getFlag('pf2e', 'actionMacro')) {
      match = macro.command.match(/^game\.pf2e\.rollActionMacro\(.*itemId: *"(?<itemId>[A-Za-z0-9]+)"/);
    } else if (macro.getFlag('pf2e', 'itemMacro')) {
      match = macro.command.match(/^game\.pf2e\.rollItemMacro\(" *(?<itemId>[A-Za-z0-9]+)"/);
      if (!match) {
        match = macro.command.match(
          /^game\.pf2e\.rollItemMacro\("Actor\.([A-Za-z0-9]+)\.Item\.(?<itemId>[A-Za-z0-9]+)"/
        );
      }
    }

    if (match) {
      const itemId = match.groups?.itemId;
      return actor.items.get(itemId);
    }

    return null;
  }

  /** @override */
  static getTokenRange(token) {
    const actor = token.actor;
    // Enforce swarm: swarms have 0 reach regardless of size or gear
    if (actor?.system?.traits?.value?.includes?.('swarm')) return [{ range: 0 }];

    const reachValue = actor?.getReach?.({ action: 'attack' }) || 0;
    const reach = { range: reachValue };
    // Use cost-based adjustment for PF2e's 10ft reach exception
    if (reach.range === 10) reach.cost = this._reachModifiedCost;
    return [reach];
  }

  /** @override */
  static getItemRange(item, token) {
      return this.getItemRange(item, token, { overlayIds: [] });
  }

  static getItemRange(item, token, opts = {}) {
    const ranges = [];

    // Handle PF2e spells with overlays (minimal logic)
    if (item?.type === 'spell') {
      const actor = token?.actor ?? item?.actor;
      const parseFeet = (val) => {
        if (val == null) return null;
        const s = String(val).trim().toLowerCase();
        if (!s || s === 'varies') return null;
        if (s === 'touch') return 0;
        const m = s.match(/([0-9]+(?:\.[0-9]+)?)/);
        if (!m) return null;
        const n = Number(m[1]);
        return Number.isFinite(n) ? n : null;
      };
      const addRange = (n) => {
        if (!Number.isFinite(n)) return;
        if (n === 10) ranges.push({ range: 10, cost: this._reachModifiedCost });
        else ranges.push(n);
      };
      const seen = new Set();
      const addFromSys = (spellData) => {
        const rv = parseFeet(spellData?.range?.value);
        if (rv === 0) {
          let reach;
          if (actor?.system?.traits?.value?.includes?.('swarm')) reach = 0;
          else reach = actor?.getReach?.({ action: 'attack' }) || 5;
          if (!seen.has(reach)) {
            seen.add(reach);
            addRange(reach);
          }
        } else if (Number.isFinite(rv)) {
          if (!seen.has(rv)) {
            seen.add(rv);
            addRange(rv);
          }
        }
        const area = spellData?.area;
        if (area?.type === 'emanation' && Number.isFinite(area.value)) {
          const d = Number(area.value);
          if (!seen.has(d)) {
            seen.add(d);
            addRange(d);
          }
        }
      };

      const overlays = item.system?.overlays;
      const overlayIds = opts?.overlayIds;

      if (overlayIds?.length && overlays && typeof overlays === 'object') {
        // Only collect the specified overlays
        for (const id of overlayIds) {
          const ov = overlays?.[id];
          if (ov?.system) addFromSys(ov.system);
        }
        return ranges;
      }

      // Default: collect from all overlays; if none add base
      if (overlays && typeof overlays === 'object') {
        for (const ov of Object.values(overlays)) addFromSys(ov?.system ?? {});
      }
      if (!ranges.length) addFromSys(item.system);

      return ranges;
    }

    // Non-spell items: original logic
    if (item.range) {
      let increment = item.range.increment;
      let maxRange = item.range.max;

      if (increment && maxRange) {
        let range = 0;
        let maxIncrementCount = 6;
        while (range < maxRange && maxIncrementCount > 0) {
          range += increment;
          if (range > maxRange) range = maxRange;
          maxIncrementCount--;
          ranges.push(range);
        }
      } else if (increment) {
        ranges.push(increment);
      } else if (maxRange) {
        ranges.push(maxRange);
      }
    } else if (item.system.area?.type === 'emanation') {
      if (Number.isFinite(item.system.area.value)) ranges.push(item.system.area.value);
    }

    // For melee items, use PF2e's reach calculation and enforce swarm behavior.
    if (!ranges.length && item.isMelee) {
      const actor = item.actor;

      // Swarms always have 0 reach
      if (actor?.system?.traits?.value?.includes?.('swarm')) {
        ranges.push(0);
      } else {
        const reach = actor?.getReach?.({ action: 'attack', weapon: item }) || 0;
        if (reach === 10) ranges.push({ range: 10, cost: this._reachModifiedCost });
        else ranges.push(reach);
      }
    }

    // Volley trait (e.g. "volley-30"): shade the penalty zone inside this distance
    const volleyTrait = item.system?.traits?.value?.find((t) => t.startsWith('volley-'));
    if (volleyTrait) {
      const volleyRange = parseInt(volleyTrait.split('-')[1]);
      if (Number.isFinite(volleyRange) && volleyRange > 0) {
        // Shaded overlay inside volley penalty distance
        ranges.push({ range: volleyRange, shaded: true, shadeColor: '#ff0000', shadeCoverage: 0.25 });
      }
    }

    return ranges;
  }

  // PF2e has an exception for distance measurements for the 10ft reach.
  // This is a cost function which will modify distance to account for this
  static _reachModifiedCost({ distance, diagonals }) {
    if (distance === 15 && diagonals === 2) {
      return distance - 5;
    }
    return distance;
  }

  static _registerActorSheetListeners() {
    Hooks.on('renderActorSheet', (actorSheet, html) => {
      // Strike Actions
      const strikeSelector = '.actions-list.strikes-list > .strike';
      html
        .on('mouseenter', strikeSelector, (event) => {
          const actor = actorSheet.document;
          const actionIndex = $(event.target).closest(`.strike`).data('actionIndex');
          const item = actor.system.actions[actionIndex]?.item;
          this.hoverItem({ actorSheet, item });
        })
        .on('mouseleave', strikeSelector, () => this.hoverLeaveItem({ actorSheet }));

      // Inventory/Spells
      const inventorySelector = '.item-name';
      html
        .on('mouseenter', inventorySelector, (event) => {
          const itemId = $(event.target).closest(`[data-item-id]`).data('itemId');
          this.hoverItem({ actorSheet, itemId });
        })
        .on('mouseleave', inventorySelector, () => this.hoverLeaveItem({ actorSheet }));
    });
  }

  static _registerChatMessageListerners() {
    Hooks.on('renderChatMessage', (chatMessage, html) => {
        const selector = 'button[data-action="spell-variant"]';
        html
        .on('mouseenter', selector, (event) => {
            const overlayIdsRaw = $(event.currentTarget).attr('data-overlay-ids') || '';
            const overlayIds = overlayIdsRaw.split(',').map((s) => s.trim()).filter(Boolean);
            if (!overlayIds.length) return;
            this.hoverSpellVariant({ chatMessage, overlayIds });
        })
        .on('mouseleave', selector, () => this.hoverLeaveSpellVariant({ chatMessage }));
    });
  }

  static hoverSpellVariant({ chatMessage, overlayIds }) {
    try {
      const speaker = chatMessage?.speaker ?? chatMessage?.data?.speaker;
      let token = speaker?.token ? canvas.tokens?.get?.(speaker.token) : null;
      let actor = token?.actor;
      if (!token || !actor) {
        const inferred = this.getInferredActorAndToken?.() || {};
        token = token || inferred.token;
        actor = actor || inferred.actor;
      }
      if (!token || !actor) return;

      const flags = chatMessage?.flags?.pf2e ?? {};
      const uuid = flags?.origin?.uuid || flags?.item?.uuid || flags?.context?.origin?.uuid || flags?.context?.uuid;
      const item = fromUuidSync(uuid);
      if (!item || item.type !== 'spell') return;

      const ranges = this.getItemRange(item, token, { overlayIds });
      if (!ranges?.length) return;
      RangeHighlightAPI.rangeHighlight(token, { ranges });
    } catch (_e) {}
  }

  static hoverLeaveSpellVariant({ chatMessage }) {
    const speaker = chatMessage?.speaker ?? chatMessage?.data?.speaker;
    const token = speaker?.token ? canvas.tokens?.get?.(speaker.token) : null;
    if (token) RangeHighlightAPI.clearRangeHighlight(token);
  }
}
