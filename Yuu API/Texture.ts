import { Color } from "./Basic Types/Color";
import { Vector2 } from "./Basic Types/Vector2";



export class Texture {
  public imageID: number;
  public width: number;
  public height: number;

  /**
   * Creates an image in memory, make sure to destroy when done!
   * @param width in pixels
   * @param height in pixels
   */
  constructor(width: number, height: number) {
    this.imageID = Godot.image.create(Math.max(2, width), Math.max(2, height)) ?? -1;

    this.width = width;
    this.height = height;
  } //

  destroy() {
    if (this.imageID !== -1) {
      Godot.image.delete(this.imageID);

      this.imageID = -1;
    }
  }

  private pixelsArray = new Int32Array(0);

  getUVColor(uv: Vector2): { color: Color, alpha: number } | undefined {
    const x = this.width * uv.x;
    const y = this.height * uv.y;

    return this.getPixelColor(new Vector2(x, y));
  }


  getPixelColor(pixel: Vector2): { color: Color, alpha: number } | undefined {
    const data = Godot.image.getPixelColor(this.imageID, pixel.x, pixel.y);

    if (data) {
      return { color: new Color(data.r, data.g, data.b), alpha: data.a };
    }
    else {
      return undefined;
    }
  }

  setPixelsColor(pixels: Vector2[], color: Color, alpha: number) {
    if (this.imageID !== -1) {
      const length = pixels.length * 2

      if (this.pixelsArray.length < length) {
        this.pixelsArray = new Int32Array(Math.ceil(length * 1.5));
      }

      for (let i = 0; i < pixels.length; i++) {
        this.pixelsArray[i * 2] = pixels[i].x;
        this.pixelsArray[(i * 2) + 1] = pixels[i].y;
      }

      Godot.image.setPixelsColor(this.imageID, this.pixelsArray.subarray(0, length), Math.min(1, Math.max(0, color.r)), Math.min(1, Math.max(0, color.g)), Math.min(1, Math.max(0, color.b)), Math.min(1, Math.max(0, alpha)));
    }
  }

  blendPixelsColor(pixels: Vector2[], color: Color, alpha: number, originalPercentRemaining: number) {
    if (this.imageID !== -1) {
      const length = pixels.length * 2

      if (this.pixelsArray.length < length) {
        this.pixelsArray = new Int32Array(Math.ceil(length * 1.5));
      }

      for (let i = 0; i < pixels.length; i++) {
        this.pixelsArray[i * 2] = pixels[i].x;
        this.pixelsArray[(i * 2) + 1] = pixels[i].y;
      }

      Godot.image.blendPixelsColor(this.imageID, this.pixelsArray.subarray(0, length), Math.min(1, Math.max(0, color.r)), Math.min(1, Math.max(0, color.g)), Math.min(1, Math.max(0, color.b)), Math.min(1, Math.max(0, alpha)), Math.min(1, Math.max(0, originalPercentRemaining)));
    }
  }

  /** Fill an entire image with a given color
   * @param color to apply
   * @param alpha to apply
   */
  fillWithColor(color: Color, alpha: number) {
    Godot.image.fillWithColor(this.imageID, Math.min(1, Math.max(0, color.r)), Math.min(1, Math.max(0, color.g)), Math.min(1, Math.max(0, color.b)), Math.min(1, Math.max(0, alpha)));
  }

  /** Fill a rectangle on an image with a given color
   * @param startPixel to create the rectangle from
   * @param rectangleSize in pixels
   * @param color to apply
   * @param alpha to apply
   */
  fillRectWithColor(startPixel: Vector2, rectangleSize: Vector2, color: Color, alpha: number) {
    Godot.image.fillRectWithColor(this.imageID, Math.min(1, Math.max(0, color.r)), Math.min(1, Math.max(0, color.g)), Math.min(1, Math.max(0, color.b)), Math.min(1, Math.max(0, alpha)), startPixel.x, startPixel.y, rectangleSize.x, rectangleSize.y);
  }

  /**
   * Copy a rectangle from a texture and paste it at a destination on this texture
   * @param destPixel of this texture
   * @param copyFromTexture to copy rectangle from
   * @param copyFromPixel start the rectangle from
   * @param rectangleSize to copy and paste
   */
  fillRectWithImage(destPixel: Vector2, copyFromTexture: Texture, copyFromPixel: Vector2, rectangleSize: Vector2) {
    Godot.image.fillRectWithImage(this.imageID, destPixel.x, destPixel.y, copyFromTexture.imageID, copyFromPixel.x, copyFromPixel.y, rectangleSize.x, rectangleSize.y);
  }

  /**
   * Copy a rectangle from a texture and paste it at a destination on this texture using alpha
   * @param destPixel of this texture
   * @param copyFromTexture to copy rectangle from
   * @param copyFromPixel start the rectangle from
   * @param rectangleSize to copy and paste
   */
  blendRectWithImage(destPixel: Vector2, copyFromTexture: Texture, copyFromPixel: Vector2, rectangleSize: Vector2) {
    Godot.image.blendRectWithImage(this.imageID, destPixel.x, destPixel.y, copyFromTexture.imageID, copyFromPixel.x, copyFromPixel.y, rectangleSize.x, rectangleSize.y);
  }

  updateTexture() {
    if (this.imageID !== -1) {
      Godot.image.updateTexture(this.imageID);
    }
  }

  updateMipMaps() {
    if (this.imageID !== -1) {
      Godot.image.updateMipMaps(this.imageID);
    }
  }

  deleteMipMaps() {
    if (this.imageID !== -1) {
      Godot.image.deleteMipMaps(this.imageID);
    }
  }
}