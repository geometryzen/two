import { root } from './root.js';

export const TWO_PI = Math.PI * 2;
export const HALF_PI = Math.PI * 0.5;

/**
 * @name Two.Utils.lerp
 * @function
 * @param {Number} a - Start value.
 * @param {Number} b - End value.
 * @param {Number} t - Zero-to-one value describing percentage between a and b.
 * @returns {Number}
 * @description Linear interpolation between two values `a` and `b` by an amount `t`.
 */
export function lerp(a: number, b: number, t: number): number {
    return t * (b - a) + a;
}

/**
 * @name Two.Utils.getPoT
 * @param {Number} value - The number to find the nearest power-of-two value
 * @returns {Number}
 * @description Rounds a number up to the nearest power-of-two value.
 * @see {@link https://en.wikipedia.org/wiki/Power_of_two}
 */
const pots = [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096];
export function getPoT(value: number) {
    let i = 0;
    while (pots[i] && pots[i] < value) {
        i++;
    }
    return pots[i];
}

/**
 * @name Two.Utils.mod
 * @function
 * @param {Number} v - The value to modulo
 * @param {Number} l - The value to modulo by
 * @returns {Number}
 * @description Modulo with added functionality to handle negative values in a positive manner.
 */
export function mod(v: number, l: number): number {

    while (v < 0) {
        v += l;
    }

    return v % l;

}

export const NumArray = root.Float32Array || Array<number>;
const floor = Math.floor;

/**
* @name Two.Utils.toFixed
* @function
* @param {Number} v - Any float
* @returns {Number} That float trimmed to the third decimal place.
* @description A pretty fast toFixed(3) alternative.
* @see {@link http://jsperf.com/parsefloat-tofixed-vs-math-round/18}
*/
export function toFixed(v: number): number {
    return floor(v * 1000000) / 1000000;
}
