import { atomic } from '@geometryzen/reactive';
import { BehaviorSubject } from 'rxjs';
import { Children } from '../children';
import { Constants } from '../constants';
import { ElementBase } from '../element';
import { Group } from '../group';
import { Disposable } from '../reactive/Disposable';
import { DisposableObservable, Observable } from '../reactive/Observable';
import { Stop } from './stop';

/**
 *
 */
export abstract class Gradient<T extends 'linear-gradient' | 'radial-gradient'> extends ElementBase<Group, T> {

    _flagStops = false;

    /**
     * Indicates what happens if the gradient starts or ends inside the bounds of the target rectangle.
     * @see {@link https://www.w3.org/TR/SVG11/pservers.html#LinearGradientElementSpreadMethodAttribute} for more information
     */
    readonly #spreadMethod = atomic('pad' as 'pad' | 'reflect' | 'repeat');
    /**
     * Indicates how coordinate values are interpreted by the renderer.
     * @see {@link https://www.w3.org/TR/SVG11/pservers.html#RadialGradientElementGradientUnitsAttribute} for more information
     */
    readonly #units = atomic('userSpaceOnUse' as 'userSpaceOnUse' | 'objectBoundingBox');

    _stops: Children<Stop> | null = null;
    _stops_insert: Disposable | null = null;
    _stops_remove: Disposable | null = null;

    readonly _change: BehaviorSubject<this> = new BehaviorSubject(this);
    readonly change$: Observable<this> = new DisposableObservable(this._change.asObservable());

    readonly _stop_subscriptions: { [id: string]: Disposable } = {};

    constructor(stops?: Stop[]) {

        super(Constants.Identifier + Constants.uniqueId());

        this.classList = [];

        this.spreadMethod = 'pad';

        this.#set_children(stops);
    }

    override dispose(): void {
        this.#unset_children();
        super.dispose();
    }

    /**
     * Trying to stay DRY here, but this may not be the best factoring. 
     */
    #set_children(children: Stop[]): void {
        this._stops = new Children((children || []).slice(0));

        this._stops_insert = this._stops.insert$.subscribe((stops: Stop[]) => {
            let i = stops.length;
            while (i--) {
                const stop = stops[i];
                this._stop_subscriptions[stop.id] = stop.change$.subscribe(() => {
                    this._flagStops = true;
                });
                stop.parent = this as unknown as Gradient<'linear-gradient' | 'radial-gradient'>;
            }
        });

        this._stops_remove = this._stops.remove$.subscribe((stops: Stop[]) => {
            let i = stops.length;
            while (i--) {
                const stop = stops[i];
                const subscription = this._stop_subscriptions[stop.id];
                subscription.dispose();
                delete this._stop_subscriptions[stop.id];
                delete stops[i].parent;
            }
        });

        // Notify renderer of initial stops.
        this._stops.ping();
    }

    #unset_children(): void {
        if (this._stops_insert) {
            this._stops_insert.dispose();
            this._stops_insert = null;
        }
        if (this._stops_remove) {
            this._stops_remove.dispose();
            this._stops_remove = null;
        }
        if (this._stops) {
            this._stops.dispose();
            this._stops = null;
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    update(bubbles = false): this {
        if (this._flagStops) {
            this._change.next(this);
        }
        return this;
    }

    override flagReset(dirtyFlag = false): this {
        this._flagStops = dirtyFlag;
        super.flagReset(dirtyFlag);
        return this;
    }
    get spreadMethod(): 'pad' | 'reflect' | 'repeat' {
        return this.#spreadMethod.get();
    }
    set spreadMethod(spread: 'pad' | 'reflect' | 'repeat') {
        this.#spreadMethod.set(spread);
    }
    get stops() {
        // TODO: Should we be returning a defensive copy?
        return this._stops.get();
    }
    set stops(stops: Stop[]) {
        this.#unset_children();
        this.#set_children(stops);
    }
    get units(): 'userSpaceOnUse' | 'objectBoundingBox' {
        return this.#units.get();
    }
    set units(units: 'userSpaceOnUse' | 'objectBoundingBox') {
        this.#units.set(units);
    }
}
