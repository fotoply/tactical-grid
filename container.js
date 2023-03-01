import { CustomSpriteMaskFilter } from './filters/CustomSpriteMaskFilter.js';
import { getDispositionColor, getGridColorString } from './scripts/utils.js';
import { cleanLayerName, MODULE_CONFIG } from './settings.js';

export class GridMaskContainer extends CachedContainer {
  /** @override */
  clearColor = [0, 0, 0, 0];

  constructor() {
    super(new PIXI.Sprite());
  }

  onCanvasReady() {
    this.destroyMask();
    this._grid = canvas.grid.children.find(
      (c) => c instanceof SquareGrid || c instanceof HexagonalGrid
    );

    if (MODULE_CONFIG[`${cleanLayerName(canvas.activeLayer)}Enabled`]) {
      this.activateMask();
    }
  }

  /**
   * Identifies the Tokens that masks need to be drawn for and
   * assigns them one
   */
  drawMask(layer = canvas.activeLayer) {
    if (!this._grid || !MODULE_CONFIG[`${cleanLayerName(layer)}Enabled`]) return;

    this._grid.visible = false;

    if (MODULE_CONFIG.enableInCombatOnly && !game.combat?.started) {
      this.destroyMask();
      return;
    }

    const applicableTokens = layer.placeables.filter(
      (p) =>
        (MODULE_CONFIG.controlled && p.controlled) ||
        (MODULE_CONFIG.hover && (p.hover || hasPreview(p)))
    );

    if (MODULE_CONFIG.ruler && typeof libWrapper === 'function') {
      let ruler = canvas.controls.ruler;
      if (ruler && ruler._state !== Ruler.STATES.INACTIVE) {
        ruler.id = 'RULER';
        if (!ruler.center) {
          Object.defineProperty(ruler, 'center', {
            get: () => ruler.destination,
          });
        }
        applicableTokens.push(ruler);
      }
    }

    if (applicableTokens.length === 0) {
      this.destroyMask();
      return;
    }

    if (this.updateGridMask(applicableTokens)) {
      for (const p of applicableTokens) {
        this.setMaskPosition(p);
      }

      if (!this._grid.filters) {
        canvas.primary.addChild(this);
        // this._grid.filters = [new PIXI.SpriteMaskFilter(this.sprite)];
        this._grid.filters = [new CustomSpriteMaskFilter(this.sprite)];
        // this._grid.mask = this.sprite;
      }
      this._grid.visible = true;
    }
  }

  updateGridMask(placeables) {
    // Destroy sprites that are not in the placeable list
    let originalChildren = this.children;
    originalChildren.forEach((c) => {
      if (!placeables.find((p) => p.id === c.placeableId)) this.removeChild(c)?.destroy();
    });

    for (const p of placeables) {
      if (originalChildren.find((c) => c.placeableId === p.id)) {
        // Do nothing
      } else {
        let viewDistance = p.document?.getFlag('aedifs-tactical-grid', 'viewDistance');
        if (viewDistance == null) viewDistance = MODULE_CONFIG.defaultViewLength;
        if (!viewDistance) continue;

        let viewShape =
          p.document?.getFlag('aedifs-tactical-grid', 'viewShape') ||
          MODULE_CONFIG.defaultViewShape;

        // const width = p.document.width ?? p.width;
        // const height = p.document.height ?? p.height;

        const width = p.width;
        const height = p.height;

        let shapeColor = p.document?.getFlag('aedifs-tactical-grid', 'color');
        if (shapeColor) {
          shapeColor = Number(Color.fromString(shapeColor));
        } else if (MODULE_CONFIG.useDispositionColors && p.document.hasOwnProperty('disposition')) {
          shapeColor = getDispositionColor(p);
        } else {
          shapeColor = Number(Color.fromString(getGridColorString()));
        }

        let sprite;
        switch (viewShape) {
          case 'square':
            let length = viewDistance * canvas.grid.w * 2 + width + 1;
            sprite = new PIXI.Graphics()
              .beginFill(shapeColor)
              .drawRect(0, 0, length, length)
              .endFill();
            break;
          case 'square-soft':
            sprite = PIXI.Sprite.from('modules\\aedifs-tactical-grid\\images\\square_mask.webp');
            break;
          case 'hexagonRow':
            let pointsRow = HexagonalGrid.pointyHexPoints
              .flat()
              .map((v) => v * canvas.grid.w * viewDistance * 2);
            sprite = new PIXI.Graphics().beginFill(shapeColor).drawPolygon(pointsRow).endFill();
            break;
          case 'hexagonCol':
            let pointsCol = HexagonalGrid.flatHexPoints
              .flat()
              .map((v) => v * canvas.grid.w * viewDistance * 2);
            sprite = new PIXI.Graphics().beginFill(shapeColor).drawPolygon(pointsCol).endFill();
            break;
          case 'circle-soft':
            sprite = PIXI.Sprite.from('modules\\aedifs-tactical-grid\\images\\circle_mask.webp');
            break;
          case 'circle':
          default:
            const radius = viewDistance * canvas.grid.w + width / 2;
            sprite = new PIXI.Graphics()
              .beginFill(shapeColor)
              .drawCircle(radius, radius, radius)
              .endFill();
        }

        if (sprite instanceof PIXI.Sprite) {
          sprite.width = (viewDistance + 1) * canvas.grid.w * 2 + width;
          sprite.height = (viewDistance + 1) * canvas.grid.h * 2 + height;
          sprite.tint = shapeColor;
        }

        sprite = this.addChild(sprite);
        sprite.placeableId = p.id;
        if (MODULE_CONFIG.mixColors) sprite.blendMode = PIXI.BLEND_MODES.ADD;
      }
    }

    if (this.children.length === 0) {
      this.destroyMask();
      return false;
    }
    return true;
  }

  /**
   * Update mask positions
   * Expecting the object to have 'id', 'center', 'width' and 'height'
   */
  setMaskPosition(target) {
    if (hasPreview(target)) return;
    const shapeMask = this.children.find((c) => c.placeableId === target.id);

    if (shapeMask) {
      const { x, y } = target.center;
      // console.log(x, y, hasPreview(target));
      shapeMask.position.set(x - shapeMask.width / 2, y - shapeMask.height / 2);
    }
  }

  activateMask() {
    if (this._grid) {
      this._grid.visible = false;
      this.drawMask();
    }
  }

  deactivateMask() {
    this.destroyMask();
    this._grid.visible = true;
  }

  destroyMask() {
    this.removeChildren().forEach((c) => c.destroy());
    if (this._grid?.filters) {
      canvas.primary.removeChild(this);
      this._grid.filters = null;
    }
  }
}

/**
 * Utility to check if a placeable has a preview drawn which occurs when it is being dragged
 */
function hasPreview(placeable) {
  return Boolean(
    placeable.layer?.preview?.children?.find((c) => c.id === placeable.id && placeable !== c)
  );
}
