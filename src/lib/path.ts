import { state } from '@geometryzen/reactive';
import { Anchor } from './anchor';
import { Collection } from './collection';
import { Color, is_color_provider } from './effects/ColorProvider';
import { Flag } from './Flag';
import { Group } from './group';
import { IBoard } from './IBoard';
import { decompose_2d_3x3_matrix } from './math/decompose_2d_3x3_matrix';
import { G20 } from './math/G20.js';
import { Disposable } from './reactive/Disposable';
import { variable } from './reactive/variable';
import { PositionLike, Shape } from './shape';
import { getComponentOnCubicBezier, getCurveBoundingBox, getCurveFromPoints } from './utils/curves';
import { lerp, mod } from './utils/math';
import { Commands } from './utils/path-commands';
import { contains, getCurveLength, getIdByLength, getSubdivisions } from './utils/shape';

export function get_dashes_offset(dashes: number[]): number | undefined {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (dashes as any)['offset'];
}

export function set_dashes_offset(dashes: number[], offset: number): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (dashes as any)['offset'] = offset;
}

const min = Math.min;
const max = Math.max;

const vector = new G20();

export interface PathAttributes {
    attitude: G20;
    id: string,
    opacity: number;
    position: PositionLike;
    visibility: 'visible' | 'hidden' | 'collapse';
}

export class Path extends Shape<Group, 'path'> implements PathAttributes {

    #length = 0;

    readonly #lengths: number[] = [];

    #fill = state('#fff' as Color);
    #fill_change: Disposable | null = null;
    #fill_opacity = state(1.0);

    #stroke = state('#000' as Color);
    #stroke_change: Disposable | null = null;
    #stroke_width = state(1);
    #stroke_opacity = state(1.0);

    #vectorEffect: 'none' | 'non-scaling-stroke' | 'non-scaling-size' | 'non-rotation' | 'fixed-position' = 'non-scaling-stroke';

    /**
     * stroke-linecap
     */
    #cap: 'butt' | 'round' | 'square' = 'round';

    /**
     * stroke-linejoin
     */
    #join: 'arcs' | 'bevel' | 'miter' | 'miter-clip' | 'round' = 'round';

    /**
     * stroke-miterlimit
     */
    #miter = 4;

    #closed = true;
    #curved = false;
    #automatic = true;
    #beginning = 0.0;
    #ending = 1.0;

    #mask: Shape<Group, string> | null = null;

    #clip = false;

    #dashes: number[] = null;

    /**
     * The hidden variable behind the `vertices` property.
     */
    #vertices: Collection<Anchor>;
    // TODO; These could be unified into e.g. vertices_disposables.
    #vertices_insert: Disposable | null = null;
    #vertices_remove: Disposable | null = null;
    /**
     * [Q] What exactly is this?
     * [A] It appears to be a working storage between the model vertices here and those that are used to compute the SVG path `d` attribute.
     */
    readonly #anchors: Anchor[] = [];

    readonly #anchor_change_map = new Map<Anchor, Disposable>();

    /**
     * @param vertices A list of {@link Anchor}s that represent the order and coordinates to construct the rendered shape.
     * @param closed Describes whether the path is closed or open.
     * @param curved Describes whether the path automatically calculates bezier handles for each vertex.
     * @param manual Describes whether the developer controls how vertices are plotted or if Two.js automatically plots coordinates based on closed and curved booleans.
     */
    constructor(board: IBoard, vertices: Anchor[] = [], closed?: boolean, curved?: boolean, manual?: boolean, attributes: Partial<PathAttributes> = {}) {

        super(board, attributes);

        this.flagReset(true);
        this.flags[Flag.Mask] = false;
        this.flags[Flag.Clip] = false;

        this.zzz.type = 'path';
        this.zzz.vertices = [];
        this.zzz.vertices_subject = variable(0);
        this.zzz.vertices$ = this.zzz.vertices_subject.asObservable();

        /**
         * Determines whether a final line is drawn between the final point in the `vertices` array and the first point.
         */
        this.closed = !!closed;

        /**
         * When the path is `automatic = true` this boolean determines whether the lines between the points are curved or not.
         */
        this.curved = !!curved;

        /**
         * Number between zero and one to state the beginning of where the path is rendered.
         * A percentage value that represents at what percentage into the path should the renderer start drawing.
         */
        this.beginning = 0;

        /**
         * Number between zero and one to state the ending of where the path is rendered.
         */
        this.ending = 1;

        // Style properties

        /**
         * The value of what the path should be filled in with.
         * @see {@link https://developer.mozilla.org/en-US/docs/Web/CSS/color_value} for more information on CSS's colors as `String`.
         */
        this.fill = '#fff';

        /**
         * The value of what the path should be outlined in with.
         * @see {@link https://developer.mozilla.org/en-US/docs/Web/CSS/color_value} for more information on CSS's colors as `String`.
         */
        this.stroke = '#000';

        this.strokeWidth = 1;

        this.strokeOpacity = 1.0;

        /**
         * A class to be applied to the element to be compatible with CSS styling.
         */
        this.className = '';

        /**
         * @see {@link https://www.w3.org/TR/SVG11/painting.html#StrokeLinecapProperty}
         */
        this.cap = 'butt';      // Default of Adobe Illustrator

        /**
         * @see {@link https://www.w3.org/TR/SVG11/painting.html#StrokeLinejoinProperty}
         */
        this.join = 'miter';    // Default of Adobe Illustrator

        /**
         * @see {@link https://www.w3.org/TR/SVG11/painting.html#StrokeMiterlimitProperty}
         */
        this.miter = 4;         // Default of Adobe Illustrator

        this.vertices = new Collection(vertices);

        this.automatic = !manual;

        /**
         * Array of numbers. Odd indices represent dash length. Even indices represent dash space.
         * A list of numbers that represent the repeated dash length and dash space applied to the stroke of the text.
         * @see {@link https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute/stroke-dasharray} for more information on the SVG stroke-dasharray attribute.
         */
        this.dashes = [];

        set_dashes_offset(this.dashes, 0);
    }

    /**
     * A convenience method for setting the `fill` attribute to "none".
     */
    noFill(): this {
        this.fill = 'none';
        return this;
    }

    /**
     * A convenience method for setting the `stroke` attribute to "none".
     */
    noStroke(): this {
        this.stroke = 'none';
        return this;
    }

    corner(): this {
        const rect = this.getBoundingClientRect(true);
        const hw = rect.width / 2;
        const hh = rect.height / 2;
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;

        for (let i = 0; i < this.vertices.length; i++) {
            const v = this.vertices.getAt(i);
            v.x -= cx;
            v.y -= cy;
            v.x += hw;
            v.y += hh;
        }

        if (this.mask) {
            this.mask.position.x -= cx;
            this.mask.position.x += hw;
            this.mask.position.y -= cy;
            this.mask.position.y += hh;
        }
        return this;
    }

    center(): this {
        const rect = this.getBoundingClientRect(true);

        const cx = rect.left + rect.width / 2 - this.position.x;
        const cy = rect.top + rect.height / 2 - this.position.y;

        for (let i = 0; i < this.vertices.length; i++) {
            const v = this.vertices.getAt(i);
            v.x -= cx;
            v.y -= cy;
        }

        if (this.mask) {
            this.mask.position.x -= cx;
            this.mask.position.y -= cy;
        }

        return this;

    }

    getBoundingClientRect(shallow?: boolean): { width: number; height: number; top?: number; left?: number; right?: number; bottom?: number } {

        let left = Infinity;
        let right = -Infinity;
        let top = Infinity;
        let bottom = -Infinity;

        // TODO: Update this to not __always__ update. Just when it needs to.
        this.update();

        const M = shallow ? this.matrix : this.worldMatrix;

        let border = (this.strokeWidth || 0) / 2;
        const l = this.zzz.vertices.length;

        if (this.strokeWidth > 0 || (this.stroke && typeof this.stroke === 'string' && !(/(transparent|none)/i.test(this.stroke)))) {
            if (this.matrix.manual) {
                const { scaleX, scaleY } = decompose_2d_3x3_matrix(M);
                border = max(scaleX, scaleY) * (this.strokeWidth || 0) / 2;
            }
            else {
                border *= max(this.scaleXY.x, this.scaleXY.y);
            }
        }

        if (l <= 0) {
            return {
                width: 0,
                height: 0
            };
        }

        for (let i = 0; i < l; i++) {

            const v1 = this.zzz.vertices[i];
            // If i = 0, then this "wraps around" to the last vertex. Otherwise, it's the previous vertex.
            // This is important for handling cyclic paths.
            const v0 = this.zzz.vertices[(i + l - 1) % l];

            const [v0x, v0y] = M.multiply_vector(v0.x, v0.y);
            const [v1x, v1y] = M.multiply_vector(v1.x, v1.y);

            if (v0.controls && v1.controls) {

                let rx = v0.controls.right.x;
                let ry = v0.controls.right.y;

                if (v0.relative) {
                    rx += v0.x;
                    ry += v0.y;
                }

                const [c0x, c0y] = M.multiply_vector(rx, ry);

                let lx = v1.controls.left.x;
                let ly = v1.controls.left.y;

                if (v1.relative) {
                    lx += v1.x;
                    ly += v1.y;
                }

                const [c1x, c1y] = M.multiply_vector(lx, ly);

                const bb = getCurveBoundingBox(
                    v0x, v0y,
                    c0x, c0y,
                    c1x, c1y,
                    v1x, v1y
                );

                top = min(bb.min.y - border, top);
                left = min(bb.min.x - border, left);
                right = max(bb.max.x + border, right);
                bottom = max(bb.max.y + border, bottom);
            }
            else {
                if (i <= 1) {
                    top = min(v0y - border, top);
                    left = min(v0x - border, left);
                    right = max(v0x + border, right);
                    bottom = max(v0y + border, bottom);
                }
                top = min(v1y - border, top);
                left = min(v1x - border, left);
                right = max(v1x + border, right);
                bottom = max(v1y + border, bottom);
            }
        }

        return {
            top: top,
            left: left,
            right: right,
            bottom: bottom,
            width: right - left,
            height: bottom - top
        };
    }

    hasBoundingClientRect(): boolean {
        return true;
    }

    /**
     * TODO: Bad name. This function is called for its side effects which are to modify the Anchor.
     * Originally the function appears to promote a Vector and return an Anchor, but this is not used
     * and the call always involves an Anchor.
     * There is a return value but it is not being used.
     * @param t Percentage value describing where on the {@link Path} to estimate and assign coordinate values.
     * @param anchor - Object to apply calculated x, y to. If none available returns new `Object`.
     * @description Given a float `t` from 0 to 1, return a point or assign a passed `obj`'s coordinates to that percentage on this {@link Path}'s curve.
     */
    getPointAt(t: number, anchor: Anchor): Anchor {
        /**
         * This line proves that the anchor argument is not re-assigned. 
         */
        const ank = anchor;

        /**
         * target is initialized to the distance along the total `length` determined by `t`.
         */
        let target = this.length * min(max(t, 0), 1);
        /**
         * The number of vertices.
         */
        const Nvs = this.vertices.length;
        const last = Nvs - 1;

        let a: Anchor | null = null;
        let b: Anchor | null = null;

        /**
         * The number of length segments.
         */
        const Nseg = this.#lengths.length;
        /**
         * Keeps track of the cumulative distance travelled over the segments.
         */
        let sum = 0;
        for (let i = 0; i < Nseg; i++) {
            // When the target point lies inside the current segment...
            if (sum + this.#lengths[i] >= target) {
                // Determine the anchors that enclose the target...
                let ia: number;
                let ib: number;
                if (this.closed) {
                    ia = mod(i, Nvs);
                    ib = mod(i - 1, Nvs);
                    if (i === 0) {
                        ia = ib;
                        ib = i;
                    }
                }
                else {
                    ia = i;
                    ib = min(max(i - 1, 0), last);
                }
                a = this.vertices.getAt(ia);
                b = this.vertices.getAt(ib);

                // We'll be breaking out of the loop and target will not be used anymore,
                // so we could introduce a new variable here. The goal seems to be to re-use t for some lerping
                // later on, so this new t value must somehow be better?
                target -= sum;
                if (this.#lengths[i] !== 0) {
                    t = target / this.#lengths[i];
                }
                else {
                    t = 0;
                }
                break;
            }
            sum += this.#lengths[i];
        }

        if (a === null || b === null) {
            return null;
        }

        if (!a) {
            return b;
        }
        else if (!b) {
            return a;
        }

        const right = b.controls && b.controls.right;
        const left = a.controls && a.controls.left;

        const x1 = b.x;
        const y1 = b.y;
        let x2 = (right || b).x;
        let y2 = (right || b).y;
        let x3 = (left || a).x;
        let y3 = (left || a).y;
        const x4 = a.x;
        const y4 = a.y;

        if (right && b.relative) {
            x2 += b.x;
            y2 += b.y;
        }

        if (left && a.relative) {
            x3 += a.x;
            y3 += a.y;
        }

        const x = getComponentOnCubicBezier(t, x1, x2, x3, x4);
        const y = getComponentOnCubicBezier(t, y1, y2, y3, y4);

        // Higher order points for control calculation.
        const t1x = lerp(x1, x2, t);
        const t1y = lerp(y1, y2, t);
        const t2x = lerp(x2, x3, t);
        const t2y = lerp(y2, y3, t);
        const t3x = lerp(x3, x4, t);
        const t3y = lerp(y3, y4, t);

        // Calculate the returned points control points.
        const brx = lerp(t1x, t2x, t);
        const bry = lerp(t1y, t2y, t);
        const alx = lerp(t2x, t3x, t);
        const aly = lerp(t2y, t3y, t);

        ank.x = x;
        ank.y = y;

        ank.controls.left.x = brx;
        ank.controls.left.y = bry;
        ank.controls.right.x = alx;
        ank.controls.right.y = aly;

        if (!(typeof ank.relative === 'boolean') || ank.relative) {
            ank.controls.left.x -= x;
            ank.controls.left.y -= y;
            ank.controls.right.x -= x;
            ank.controls.right.y -= y;
        }

        ank.t = t;

        return ank;
    }

    /**
     * Based on closed / curved and sorting of vertices plot where all points should be and where the respective handles should be too.
     */
    plot(): this {
        if (this.curved) {
            getCurveFromPoints(this.#vertices, this.closed);
            return this;
        }
        for (let i = 0; i < this.#vertices.length; i++) {
            this.#vertices.getAt(i).command = i === 0 ? Commands.move : Commands.line;
        }
        return this;
    }

    /**
     * Insert an anchor at the midpoint between every vertex.
     * @param limit - How many times to recurse subdivisions.
     */
    subdivide(limit: number): this {
        // TODO: DRYness (function below)
        this.update();

        const last = this.vertices.length - 1;
        const closed = this.closed || this.vertices.getAt(last).command === Commands.close;
        let b = this.vertices.getAt(last);
        let points: Anchor[] = [], verts;

        this.vertices.forEach((a, i) => {

            if (i <= 0 && !closed) {
                b = a;
                return;
            }

            if (a.command === Commands.move) {
                points.push(new Anchor(G20.vector(b.x, b.y)));
                if (i > 0) {
                    points[points.length - 1].command = Commands.line;
                }
                b = a;
                return;
            }

            verts = getSubdivisions(a, b, limit);
            points = points.concat(verts);

            // Assign commands to all the verts
            verts.forEach(function (v, i) {
                if (i <= 0 && b.command === Commands.move) {
                    v.command = Commands.move;
                }
                else {
                    v.command = Commands.line;
                }
            });

            if (i >= last) {

                // TODO: Add check if the two vectors in question are the same values.
                if (this.closed && this.automatic) {

                    b = a;

                    verts = getSubdivisions(a, b, limit);
                    points = points.concat(verts);

                    // Assign commands to all the verts
                    verts.forEach(function (v, i) {
                        if (i <= 0 && b.command === Commands.move) {
                            v.command = Commands.move;
                        }
                        else {
                            v.command = Commands.line;
                        }
                    });

                }
                else if (closed) {
                    points.push(new Anchor(G20.vector(a.x, a.y)));
                }

                points[points.length - 1].command = closed
                    ? Commands.close : Commands.line;

            }

            b = a;

        });

        this.automatic = false;
        this.curved = false;
        this.vertices = new Collection(points);

        return this;
    }

    #updateLength(limit?: number, silent = false): this {
        // TODO: DRYness (function above)
        if (!silent) {
            this.update();
        }

        const length = this.vertices.length;
        const last = length - 1;
        const closed = false;//this.closed || this.vertices[last]._command === Commands.close;

        let b = this.vertices.getAt(last);
        let sum = 0;

        this.vertices.forEach((a: Anchor, i: number) => {

            if ((i <= 0 && !closed) || a.command === Commands.move) {
                b = a;
                this.#lengths[i] = 0;
                return;
            }

            this.#lengths[i] = getCurveLength(a, b, limit);
            sum += this.#lengths[i];

            if (i >= last && closed) {

                b = this.vertices.getAt((i + 1) % length);

                this.#lengths[i + 1] = getCurveLength(a, b, limit);
                sum += this.#lengths[i + 1];

            }

            b = a;
        });

        this.#length = sum;
        this.flags[Flag.Length] = false;

        return this;
    }

    override update(): this {
        if (this.flags[Flag.Vertices]) {

            if (this.automatic) {
                this.plot();
            }

            if (this.flags[Flag.Length]) {
                this.#updateLength(undefined, true);
            }

            const closed = this.closed;

            const beginning = min(this.beginning, this.ending);
            const ending = max(this.beginning, this.ending);

            const lBound = Math.ceil(getIdByLength(this, beginning * this.length));
            const uBound = Math.floor(getIdByLength(this, ending * this.length));

            {
                /**
                 * Assigned in the for loop, used after the for loop.
                 */
                let left: Anchor;
                /**
                 * Assigned in the for loop, used after the for loop.
                 */
                let next: Anchor;

                /**
                 * The source for the updates are the vertices maintained by derived classes that specialize Path.
                 */
                const vertices = this.vertices;
                this.zzz.vertices.length = 0;
                {
                    let right: Anchor;
                    let prev: Anchor;
                    const L = vertices.length;
                    for (let i = 0; i < L; i++) {

                        if (this.#anchors.length <= i) {
                            // Expected to be `relative` anchor points.
                            this.#anchors.push(new Anchor(G20.vector(0, 0)));
                        }

                        if (i > uBound && !right) {

                            const v = this.#anchors[i].copy(vertices.getAt(i));
                            this.getPointAt(ending, v);
                            v.command = this.#anchors[i].command;
                            this.zzz.vertices.push(v);

                            right = v;
                            prev = vertices.getAt(i - 1);

                            // Project control over the percentage `t`
                            // of the in-between point
                            if (prev && prev.controls) {

                                if (v.relative) {
                                    v.controls.right.clear();
                                }
                                else {
                                    v.controls.right.copy(v.origin);
                                }

                                if (prev.relative) {
                                    this.#anchors[i - 1].controls.right
                                        .copy(prev.controls.right)
                                        .lerp(G20.zero, 1 - v.t);
                                }
                                else {
                                    this.#anchors[i - 1].controls.right
                                        .copy(prev.controls.right)
                                        .lerp(prev.origin, 1 - v.t);
                                }
                            }
                        }
                        else if (i >= lBound && i <= uBound) {

                            const v = this.#anchors[i].copy(vertices.getAt(i));
                            this.zzz.vertices.push(v);

                            if (i === uBound && contains(this, ending)) {
                                right = v;
                                if (!closed && right.controls) {
                                    if (right.relative) {
                                        right.controls.right.clear();
                                    }
                                    else {
                                        right.controls.right.copy(right.origin);
                                    }
                                }
                            }
                            else if (i === lBound && contains(this, beginning)) {
                                left = v;
                                left.command = Commands.move;
                                if (!closed && left.controls) {
                                    if (left.relative) {
                                        left.controls.left.clear();
                                    }
                                    else {
                                        left.controls.left.copy(left.origin);
                                    }
                                }
                            }
                        }
                    }
                }

                // Prepend the trimmed point if necessary.
                if (lBound > 0 && !left) {

                    const i = lBound - 1;

                    const v = this.#anchors[i].copy(vertices.getAt(i));
                    this.getPointAt(beginning, v);
                    v.command = Commands.move;
                    this.zzz.vertices.unshift(v);

                    next = vertices.getAt(i + 1);

                    // Project control over the percentage `t`
                    // of the in-between point
                    if (next && next.controls) {

                        v.controls.left.clear();

                        if (next.relative) {
                            this.#anchors[i + 1].controls.left
                                .copy(next.controls.left)
                                .lerp(G20.zero, v.t);
                        }
                        else {
                            vector.copy(next.origin);
                            this.#anchors[i + 1].controls.left
                                .copy(next.controls.left)
                                .lerp(next.origin, v.t);
                        }
                    }
                }
            }
            this.zzz.vertices_subject.set(this.zzz.vertices_subject.get() + 1);
        }
        super.update();
        return this;
    }

    override flagReset(dirtyFlag = false): this {

        this.flags[Flag.Cap] = dirtyFlag;
        this.flags[Flag.Clip] = dirtyFlag;
        this.flags[Flag.Fill] = dirtyFlag;
        this.flags[Flag.Join] = dirtyFlag;
        this.flags[Flag.Length] = dirtyFlag;
        this.flags[Flag.Linewidth] = dirtyFlag;
        this.flags[Flag.Mask] = dirtyFlag;
        this.flags[Flag.Miter] = dirtyFlag;
        this.flags[Flag.Stroke] = dirtyFlag;
        this.flags[Flag.VectorEffect] = dirtyFlag;
        this.flags[Flag.Vertices] = dirtyFlag;

        super.flagReset(dirtyFlag);

        return this;

    }
    get automatic(): boolean {
        return this.#automatic;
    }
    set automatic(automatic: boolean) {
        if (automatic === this.automatic) {
            return;
        }
        this.#automatic = !!automatic;
        this.vertices.forEach(function (v: Anchor) {
            if (automatic) {
                v.ignore();
            }
            else {
                v.listen();
            }
        });
    }
    get beginning(): number {
        return this.#beginning;
    }
    set beginning(beginning: number) {
        this.#beginning = beginning;
        this.flags[Flag.Vertices] = true;
    }
    /**
     * Defines the shape to be used at the end of open subpaths when they are stroked.
     * @see https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute/stroke-linecap
     */
    get cap(): 'butt' | 'round' | 'square' {
        return this.#cap;
    }
    set cap(cap: 'butt' | 'round' | 'square') {
        this.#cap = cap;
        this.flags[Flag.Cap] = true;
    }
    get clip(): boolean {
        return this.#clip;
    }
    set clip(v: boolean) {
        this.#clip = v;
        this.flags[Flag.Clip] = true;
    }
    get closed(): boolean {
        return this.#closed;
    }
    set closed(closed: boolean) {
        this.#closed = !!closed;
        this.flags[Flag.Vertices] = true;
    }
    get curved(): boolean {
        return this.#curved;
    }
    set curved(curved: boolean) {
        this.#curved = !!curved;
        this.flags[Flag.Vertices] = true;
    }
    get dashes(): number[] {
        return this.#dashes;
    }
    set dashes(dashes: number[]) {
        if (typeof get_dashes_offset(dashes) !== 'number') {
            set_dashes_offset(dashes, (this.dashes && get_dashes_offset(this.dashes)) || 0);
        }
        this.#dashes = dashes;
    }
    get ending(): number {
        return this.#ending;
    }
    set ending(ending: number) {
        this.#ending = ending;
        this.flags[Flag.Vertices] = true;
    }
    get fill(): Color {
        return this.#fill.get();
    }
    set fill(fill: Color) {
        if (this.#fill_change) {
            this.#fill_change.dispose();
            this.#fill_change = null;
        }

        this.#fill.set(fill);
        this.flags[Flag.Fill] = true;

        if (is_color_provider(fill)) {
            this.#fill_change = fill.change$.subscribe(() => {
                this.flags[Flag.Fill] = true;
            });
        }
    }
    get fillOpacity(): number {
        return this.#fill_opacity.get();
    }
    set fillOpacity(fillOpacity: number) {
        this.#fill_opacity.set(fillOpacity);
    }
    get join(): 'arcs' | 'bevel' | 'miter' | 'miter-clip' | 'round' {
        return this.#join;
    }
    set join(join: 'arcs' | 'bevel' | 'miter' | 'miter-clip' | 'round') {
        this.#join = join;
        this.flags[Flag.Join] = true;
    }
    get length(): number {
        if (this.flags[Flag.Length]) {
            this.#updateLength();
        }
        return this.#length;
    }
    get lengths(): number[] {
        return this.#lengths;
    }
    get strokeWidth(): number {
        return this.#stroke_width.get();
    }
    set strokeWidth(stroeWidth: number) {
        if (typeof stroeWidth === 'number') {
            if (this.strokeWidth !== stroeWidth) {
                this.#stroke_width.set(stroeWidth);
                this.flags[Flag.Linewidth] = true;
            }
        }
    }
    get mask(): Shape<Group, string> | null {
        return this.#mask;
    }
    set mask(mask: Shape<Group, string> | null) {
        this.#mask = mask;
        this.flags[Flag.Mask] = true;
        if (mask instanceof Shape && !mask.clip) {
            mask.clip = true;
        }
    }
    get miter(): number {
        return this.#miter;
    }
    set miter(miter: number) {
        this.#miter = miter;
        this.flags[Flag.Miter] = true;
    }
    get stroke(): Color {
        return this.#stroke.get();
    }
    set stroke(stroke: Color) {
        if (this.#stroke_change) {
            this.#stroke_change.dispose();
            this.#stroke_change = null;
        }

        this.#stroke.set(stroke);
        this.flags[Flag.Stroke] = true;

        if (is_color_provider(stroke)) {
            this.#stroke_change = stroke.change$.subscribe(() => {
                this.flags[Flag.Stroke] = true;
            });
        }
    }
    get strokeOpacity(): number {
        return this.#stroke_opacity.get();
    }
    set strokeOpacity(strokeOpacity: number) {
        this.#stroke_opacity.set(strokeOpacity);
    }
    get vertices(): Collection<Anchor> {
        return this.#vertices;
    }
    set vertices(vertices: Collection<Anchor>) {
        // Remove previous listeners
        if (this.#vertices_insert) {
            this.#vertices_insert.dispose();
            this.#vertices_insert = null;
        }
        if (this.#vertices_remove) {
            this.#vertices_remove.dispose();
            this.#vertices_remove = null;
        }

        // Create new Collection with copy of vertices
        if (vertices instanceof Collection) {
            this.#vertices = vertices;
        }
        else {
            this.#vertices = new Collection(vertices || []);
        }


        // Listen for Collection changes and bind / unbind
        this.#vertices_insert = this.vertices.insert$.subscribe((inserts: Anchor[]) => {
            let i = inserts.length;
            while (i--) {
                const anchor = inserts[i];
                const subscription = anchor.change$.subscribe(() => {
                    this.flags[Flag.Vertices] = true;
                });
                // TODO: Check that we are not already mapped?
                this.#anchor_change_map.set(anchor, subscription);
            }
            this.flags[Flag.Vertices] = true;
        });

        this.#vertices_remove = this.vertices.remove$.subscribe((removes: Anchor[]) => {
            let i = removes.length;
            while (i--) {
                const anchor = removes[i];
                const subscription = this.#anchor_change_map.get(anchor);
                subscription.dispose();
                this.#anchor_change_map.delete(anchor);
            }
            this.flags[Flag.Vertices] = true;
        });

        this.vertices.forEach((anchor: Anchor) => {
            const subscription = anchor.change$.subscribe(() => {
                this.flags[Flag.Vertices] = true;
            });
            this.#anchor_change_map.set(anchor, subscription);
        });
    }
    get vectorEffect(): 'none' | 'non-scaling-stroke' | 'non-scaling-size' | 'non-rotation' | 'fixed-position' {
        return this.#vectorEffect;
    }
    set vectorEffect(vectorEffect: 'none' | 'non-scaling-stroke' | 'non-scaling-size' | 'non-rotation' | 'fixed-position') {
        this.#vectorEffect = vectorEffect;
        this.flags[Flag.VectorEffect] = true;
    }
}
