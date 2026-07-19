import { useCallback, useRef, useState } from "react";
import union from "@turf/union";
import difference from "@turf/difference";
import { featureCollection } from "@turf/helpers";
import centroid from "@turf/centroid";
import type { Feature, Polygon, Position } from "geojson";
import type { NotificationInstance } from "antd/es/notification/interface";
import type MapboxDraw from "@mapbox/mapbox-gl-draw";
import type { Map as MapboxMap } from "mapbox-gl";
import { emojiToPolygon } from "../utils/emojiToPolygon";
import {
    MowingFeature,
    MowingAreaFeature,
    MowingFeatureBase,
    NavigationFeature,
    ObstacleFeature,
} from "../../../types/map.ts";
import { MapArea } from "../../../types/ros.ts";
import { FeatureTypeAreas, isFeatureTypeArea } from "../utils/types.ts";

// ---------------------------------------------------------------------------
// Module-level pure helpers (no React state dependency)
// ---------------------------------------------------------------------------

/** Segment–segment intersection — returns the intersection point or null. */
export function segSegIntersect(
    a1: Position,
    a2: Position,
    b1: Position,
    b2: Position,
): Position | null {
    const d1x = a2[0] - a1[0],
        d1y = a2[1] - a1[1];
    const d2x = b2[0] - b1[0],
        d2y = b2[1] - b1[1];
    const cross = d1x * d2y - d1y * d2x;
    if (Math.abs(cross) < 1e-15) return null; // parallel
    const t = ((b1[0] - a1[0]) * d2y - (b1[1] - a1[1]) * d2x) / cross;
    const u = ((b1[0] - a1[0]) * d1y - (b1[1] - a1[1]) * d1x) / cross;
    if (t < 0 || t > 1 || u < 0 || u > 1) return null; // outside segments
    return [a1[0] + t * d1x, a1[1] + t * d1y];
}

/**
 * Returns intermediate cutter-line vertices that fall between two intersection
 * points (needed for multi-segment cut lines).
 */
export function getCutterBetween(
    coords: number[][],
    p0: Position,
    p1: Position,
): Position[] {
    const result: Position[] = [];
    let inside = false;
    const dist = (a: Position, b: Position) =>
        Math.hypot(a[0] - b[0], a[1] - b[1]);
    for (const c of coords) {
        const d0 = dist(c, p0),
            d1 = dist(c, p1);
        if (d0 < 1e-12 || d1 < 1e-12) {
            if (inside) {
                inside = false;
                break;
            }
            inside = true;
            continue;
        }
        if (inside) result.push(c);
    }
    return result;
}

/**
 * Point-in-polygon test using a ray-casting algorithm.
 * Tests whether `currentLayerCoordinates` (a ring) lies inside `areaCoordinates`.
 */
export function inside(
    currentLayerCoordinates: Position[],
    areaCoordinates: Position[],
): boolean {
    let isInside = false;
    let j = areaCoordinates.length - 1;
    for (let i = 0; i < areaCoordinates.length; i++) {
        const xi = areaCoordinates[i][0];
        const yi = areaCoordinates[i][1];
        const xj = areaCoordinates[j][0];
        const yj = areaCoordinates[j][1];

        const intersect =
            yi > currentLayerCoordinates[1][1] !==
                yj > currentLayerCoordinates[1][1] &&
            currentLayerCoordinates[1][0] <
                ((xj - xi) * (currentLayerCoordinates[1][1] - yi)) / (yj - yi) +
                    xi;
        if (intersect) isInside = !isInside;
        j = i;
    }
    return isInside;
}

/**
 * Returns a new unique ID for a feature of the given `type` / `component`.
 * Pass `index` to pin the area slot; pass `null` to auto-detect the next slot.
 */
export function getNewId(
    currFeatures: Record<string, MowingFeature>,
    type: string,
    index: string | null,
    component: string,
): string {
    let maxArea = 0;
    if (index != null) {
        maxArea = parseInt(index) - 1;
    } else {
        maxArea = Object.values<MowingFeature>(currFeatures)
            .filter((f) => {
                const parts = (f.id as string).split("-");
                if (parts.length !== 4) return false;
                return parts[0] === type && component === parts[2];
            })
            .reduce((acc, val) => {
                const parts = (val.id as string).split("-");
                if (parts.length !== 4) return acc;
                const idx = parseInt(parts[1]);
                return idx > acc ? idx : acc;
            }, 0);
    }

    const maxComponent = Object.values<MowingFeature>(currFeatures)
        .filter((f) =>
            (f.id as string).startsWith(`${type}-${maxArea + 1}-${component}-`),
        )
        .reduce((acc, val) => {
            const parts = (val.id as string).split("-");
            if (parts.length !== 4) return acc;
            const idx = parseInt(parts[3]);
            return idx > acc ? idx : acc;
        }, 0);

    return `${type}-${maxArea + 1}-${component}-${maxComponent + 1}`;
}

/**
 * Sorts `MowingAreaFeature` entries inside `tosort` by mowing order and
 * re-assigns sequential `mowing_order` values (mutates in place, intentionally).
 */
export function sortFeatures(
    tosort: Record<string, MowingFeature>,
): void {
    const idxorder = Object.values(tosort).sort(
        (a: MowingFeature, b: MowingFeature) => {
            if (
                a instanceof MowingAreaFeature &&
                !(b instanceof MowingAreaFeature)
            )
                return -1;
            if (
                b instanceof MowingAreaFeature &&
                !(a instanceof MowingAreaFeature)
            )
                return 1;
            if (
                !(b instanceof MowingAreaFeature) ||
                !(a instanceof MowingAreaFeature)
            )
                return 0;

            if (a.getMowingOrder() === b.getMowingOrder()) {
                return 0;
            }

            return a.getMowingOrder() > b.getMowingOrder() ? 1 : -1;
        },
    );

    let i = 1;
    idxorder.forEach((e) => {
        if (e instanceof MowingAreaFeature) {
            e.properties.mowing_order = i;
            i++;
        }
    });
}

// ---------------------------------------------------------------------------
// Shape types
// ---------------------------------------------------------------------------

export type ShapeType = "square" | "circle" | "hexagon";

// ---------------------------------------------------------------------------
// Hook interface
// ---------------------------------------------------------------------------

export interface UseMapEditingOptions {
    features: Record<string, MowingFeature>;
    setFeatures: React.Dispatch<
        React.SetStateAction<Record<string, MowingFeature>>
    >;
    editMap: boolean;
    mowingAreas: { key: string; label: string }[];
    drawRef: React.RefObject<MapboxDraw | null>;
    notification: NotificationInstance;
    mapInstanceRef: React.RefObject<MapboxMap | null>;
}

export interface UseMapEditingReturn {
    // Modal state
    modalOpen: boolean;
    setModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
    areaModelOpen: boolean;
    setAreaModelOpen: React.Dispatch<React.SetStateAction<boolean>>;

    currentFeature: Feature | undefined;
    setCurrentFeature: React.Dispatch<
        React.SetStateAction<Feature | undefined>
    >;
    curMowingAreaFeature?: MowingFeatureBase;
    selectedFeatureIds: string[];
    setSelectedFeatureIds: React.Dispatch<React.SetStateAction<string[]>>;
    splitTargetId: string | null;

    // Labels helper
    buildLabels: (param: MowingFeature[]) => ReturnType<typeof centroid>[];

    // Draw event callbacks
    onCreate: (e: { features: Feature[] }) => void;
    onUpdate: (e: { features: Feature[] }) => void;
    onCombine: (e: {
        deletedFeatures: Feature[];
        createdFeatures: Feature[];
    }) => void;
    onDelete: (e: { features: Feature[] }) => void;
    onSelectionChange: (e: { features: GeoJSON.Feature[] }) => void;
    onOpenDetails: (e: { feature?: Feature }) => void;

    // Toolbar action handlers
    handleEditSelectedFeature: () => void;
    handleDrawPolygon: () => void;
    handleDrawShape: (shape: ShapeType, sizeMeters: number) => void;
    handleDrawEmoji: (emoji: string, sizeMeters: number) => void;
    handleTrash: () => void;
    handleCombine: () => void;
    handleAreaSelect: (id: string) => void;
    handleSubtract: () => void;
    handleSplit: () => void;

    // Modal action handlers
    handleSaveNewArea: (area: MapArea, newAreaType: FeatureTypeAreas) => void;
    updateMowingArea: (area: MapArea) => void;
    cancelNewAreaModal: () => void;
    cancelAreaModal: () => void;
    deleteFeature: () => void;
}

// ---------------------------------------------------------------------------
// Hook implementation
// ---------------------------------------------------------------------------

export function useMapEditing({
    features,
    setFeatures,
    editMap,
    mowingAreas,
    drawRef,
    notification,
    mapInstanceRef,
}: UseMapEditingOptions): UseMapEditingReturn {
    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------
    const [modalOpen, setModalOpen] = useState<boolean>(false);
    const [areaModelOpen, setAreaModelOpen] = useState<boolean>(false);
    const [currentFeature, setCurrentFeature] = useState<Feature | undefined>(
        undefined,
    );
    const [curMowingAreaFeature, setCurMowingAreaFeature] =
        useState<MowingFeatureBase>();
    const [selectedFeatureIds, setSelectedFeatureIds] = useState<string[]>([]);
    const [splitTargetId, setSplitTargetId] = useState<string | null>(null);

    const splitInProgressRef = useRef(false);

    // -----------------------------------------------------------------------
    // Labels
    // -----------------------------------------------------------------------
    const buildLabels = (param: MowingFeature[]) => {
        return param.flatMap((feature) => {
            if (!(feature instanceof MowingAreaFeature)) return [];
            if (!feature.geometry?.coordinates?.[0]?.length) return [];

            const centroidPt = centroid(feature);
            if (centroidPt.properties != null) {
                centroidPt.properties.title = feature.getFullLabel();
                centroidPt.properties.index = feature.getIndex();
            }
            centroidPt.id = feature.id;
            return [centroidPt];
        });
    };

    // -----------------------------------------------------------------------
    // Internal helpers that need closure over state
    // -----------------------------------------------------------------------

    /**
     * Generic "add polygon area" helper. Reads `currentFeature` (or an
     * explicit `new_feature`), creates the right feature class via `constructcb`,
     * and merges it into the features map.
     */
    const addArea = useCallback(
        <T extends MowingFeatureBase>(
            type: string,
            component: string,
            construct_callback: (id: string, index: number) => T | null,
            new_feature: Feature<Polygon> | undefined = undefined,
        ): string | undefined => {
            const f = new_feature ?? currentFeature;
            if (f?.geometry.type !== "Polygon") return;

            let generatedId: string | undefined;

            setFeatures((currFeatures) => {
                // ID genereren binnen de gegarandeerd up-to-date callback snapshot
                const id = getNewId(currFeatures, type, null, component);
                generatedId = id;

                // Dynamisch tellen hoeveel features van dit type er al zijn voor een sluitende index
                const currentTypeCount = Object.values(currFeatures).filter(
                    (feat) =>
                        feat.properties?.feature_type ===
                        (type === "area" ? "workarea" : type),
                ).length;

                const nfeat = construct_callback(id, currentTypeCount + 1);
                if (!nfeat) return currFeatures;

                nfeat.setGeometry((f as Feature<Polygon>).geometry);

                return {
                    ...currFeatures,
                    [id]: nfeat,
                };
            });

            setCurrentFeature(undefined);
            setModalOpen(false);
            return generatedId;
        },
        [currentFeature, setFeatures],
    );

    function addObstacle(
        new_feature: Feature<Polygon> | undefined = undefined,
    ) {
        addArea<ObstacleFeature>(
            "area",
            "obstacle",
            (id) => {
                const currentLayerCoordinates = (
                    currentFeature as Feature<Polygon>
                ).geometry.coordinates[0];
                const area = Object.values<MowingFeature>(features).find(
                    (f) => {
                        if (!(f instanceof MowingAreaFeature)) return false;
                        const areaCoordinates = f.geometry.coordinates[0];
                        return inside(currentLayerCoordinates, areaCoordinates);
                    },
                );
                if (!area) {
                    notification.info({
                        message: "Unable to match an area for this obstacle",
                    });
                    return null;
                }
                return new ObstacleFeature(id, area as MowingAreaFeature);
            },
            new_feature,
        );
    }

    function addNavigationArea(
        new_feature: Feature<Polygon> | undefined = undefined,
    ) {
        addArea<NavigationFeature>(
            "navigation",
            "area",
            (id) => new NavigationFeature(id),
            new_feature,
        );
    }

    // -----------------------------------------------------------------------
    // performSplit
    // -----------------------------------------------------------------------
    const performSplit = useCallback(
        (lineFeature: Feature, targetId: string) => {
            const targetFeat = features[targetId];
            if (
                !targetFeat ||
                !(targetFeat instanceof MowingFeatureBase) ||
                targetFeat.geometry.type !== "Polygon"
            ) {
                notification.error({
                    message: "Split target is not a valid polygon",
                });
                return;
            }

            const polygon: Feature<Polygon> = {
                type: "Feature",
                properties: {},
                geometry: targetFeat.geometry as Polygon,
            };

            // Extend the cutting line far beyond the polygon so it fully crosses through
            const rawCutCoords = (lineFeature.geometry as GeoJSON.LineString)
                .coordinates;
            const cutCoords = rawCutCoords.map((c) => [
                Number(c[0]),
                Number(c[1]),
            ]);
            const polyCoords = (targetFeat.geometry as Polygon).coordinates[0];
            let minX = Infinity,
                minY = Infinity,
                maxX = -Infinity,
                maxY = -Infinity;
            for (const c of polyCoords) {
                if (c[0] < minX) minX = c[0];
                if (c[1] < minY) minY = c[1];
                if (c[0] > maxX) maxX = c[0];
                if (c[1] > maxY) maxY = c[1];
            }
            const pad = Math.max(maxX - minX, maxY - minY) * 3;

            const c0 = cutCoords[0],
                c1 = cutCoords[1];
            const dxS = c1[0] - c0[0],
                dyS = c1[1] - c0[1];
            const lenS = Math.sqrt(dxS * dxS + dyS * dyS);
            if (lenS > 0) {
                cutCoords[0] = [
                    c0[0] - (dxS / lenS) * pad,
                    c0[1] - (dyS / lenS) * pad,
                ];
            }
            const cL = cutCoords[cutCoords.length - 1],
                cP = cutCoords[cutCoords.length - 2];
            const dxE = cL[0] - cP[0],
                dyE = cL[1] - cP[1];
            const lenE = Math.sqrt(dxE * dxE + dyE * dyE);
            if (lenE > 0) {
                cutCoords[cutCoords.length - 1] = [
                    cL[0] + (dxE / lenE) * pad,
                    cL[1] + (dyE / lenE) * pad,
                ];
            }

            try {
                const ring = (polygon.geometry as Polygon).coordinates[0];
                const ringOpen = ring.slice(0, -1);

                const hits: { index: number; point: Position }[] = [];
                for (let i = 0; i < ringOpen.length; i++) {
                    const a = ringOpen[i];
                    const b = ringOpen[(i + 1) % ringOpen.length];
                    const pt = segSegIntersect(
                        a,
                        b,
                        cutCoords[0],
                        cutCoords[cutCoords.length - 1],
                    );
                    if (pt) hits.push({ index: i, point: pt });
                }

                if (hits.length < 2) {
                    notification.error({
                        message:
                            "Line must cross the area at least twice to split it",
                    });
                    return;
                }

                hits.sort((a, b) => a.index - b.index);
                const h0 = hits[0];
                const h1 = hits[1];

                const polyACoords: Position[] = [h0.point];
                for (let i = h0.index + 1; i <= h1.index; i++) {
                    polyACoords.push(ringOpen[i]);
                }
                polyACoords.push(h1.point);
                const cutBetween = getCutterBetween(
                    cutCoords,
                    h0.point,
                    h1.point,
                );
                polyACoords.push(...[...cutBetween].reverse());
                polyACoords.push(h0.point);

                const polyBCoords: Position[] = [h1.point];
                for (
                    let i = h1.index + 1;
                    i < ringOpen.length + h0.index + 1;
                    i++
                ) {
                    polyBCoords.push(ringOpen[i % ringOpen.length]);
                }
                polyBCoords.push(h0.point);
                polyBCoords.push(...cutBetween);
                polyBCoords.push(h1.point);

                const geomA: GeoJSON.Polygon = {
                    type: "Polygon",
                    coordinates: [polyACoords],
                };
                const geomB: GeoJSON.Polygon = {
                    type: "Polygon",
                    coordinates: [polyBCoords],
                };

                setFeatures((curr) => {
                    const next = { ...curr };
                    const origFeat = next[targetId];
                    if (origFeat && origFeat instanceof MowingFeatureBase) {
                        origFeat.setGeometry(geomA);
                    }

                    const areaType = targetFeat.properties.feature_type;
                    let type: string;
                    let constructFn: (id: string) => MowingFeatureBase | null;

                    switch (areaType) {
                        case "workarea":
                            type = "area";
                            constructFn = (id) =>
                                new MowingAreaFeature(
                                    id,
                                    mowingAreas.length + 1,
                                );
                            break;
                        case "navigation":
                            type = "navigation";
                            constructFn = (id) => new NavigationFeature(id);
                            break;
                        case "obstacle": {
                            type = "area";
                            const parentArea = Object.values<MowingFeature>(
                                next,
                            ).find(
                                (f): f is MowingAreaFeature =>
                                    f instanceof MowingAreaFeature,
                            );
                            if (!parentArea) {
                                notification.error({
                                    message:
                                        "No parent area found for obstacle split",
                                });
                                return curr;
                            }
                            constructFn = (id) =>
                                new ObstacleFeature(id, parentArea);
                            break;
                        }
                        default:
                            notification.error({
                                message: `Unknown type ${areaType}`,
                            });
                            return curr;
                    }

                    const component =
                        areaType === "obstacle" ? "obstacle" : "area";
                    const newId = getNewId(next, type, null, component);
                    const newFeat = constructFn(newId);
                    if (newFeat) {
                        newFeat.setGeometry(geomB);
                        next[newId] = newFeat;
                        sortFeatures(next);
                    }

                    return next;
                });

                if (drawRef.current) {
                    const drawFeat = drawRef.current.get(targetId);
                    if (drawFeat) {
                        drawFeat.geometry = geomA;
                        drawRef.current.add(drawFeat);
                    }
                }
                notification.success({ message: "Area split into 2 pieces" });
            } catch (err) {
                notification.error({
                    message: `Split failed: ${
                        err instanceof Error ? err.message : String(err)
                    }`,
                });
            }
        },
        [features, mowingAreas.length, notification, setFeatures, drawRef],
    );

    // -----------------------------------------------------------------------
    // Draw event callbacks
    // -----------------------------------------------------------------------
    const onCreate = useCallback(
        (e: { features: Feature[] }) => {
            for (const f of e.features) {
                if (splitTargetId && f.geometry?.type === "LineString") {
                    if (splitInProgressRef.current) return;
                    splitInProgressRef.current = true;
                    performSplit(f, splitTargetId);
                    if (drawRef.current) {
                        drawRef.current.delete(f.id as string);
                    }
                    setSplitTargetId(null);
                    setTimeout(() => {
                        splitInProgressRef.current = false;
                    }, 100);
                    return;
                }
                if (f.geometry?.type !== "Polygon") {
                    if (drawRef.current) drawRef.current.delete(f.id as string);
                    continue;
                }

                if (drawRef.current) drawRef.current.delete(f.id as string);
                const new_id = addArea<MowingAreaFeature>(
                    "area",
                    "area",
                    (id) => new MowingAreaFeature(id, mowingAreas.length + 1),
                );
                f.id = new_id;
                setCurrentFeature(f);
                setModalOpen(true);
            }
        },
        [splitTargetId, performSplit, drawRef],
    );

    const onUpdate = useCallback(
        (e: { features: Feature[] }) => {
            setFeatures((currFeatures) => {
                const newFeatures = { ...currFeatures };
                for (const f of e.features) {
                    const feature = newFeatures[f.id as string];
                    if (
                        !(feature instanceof MowingAreaFeature) &&
                        !(feature instanceof ObstacleFeature) &&
                        !(feature instanceof NavigationFeature)
                    )
                        continue;
                    if (f.geometry.type === "Polygon") {
                        feature.setGeometry(f.geometry as Polygon);
                    }
                }
                return newFeatures;
            });
        },
        [setFeatures],
    );

    const onCombine = useCallback(
        (e: { deletedFeatures: Feature[]; createdFeatures: Feature[] }) => {
            const firstDeleted = e.deletedFeatures[0] as Feature<Polygon>;
            const areaType = firstDeleted?.properties?.feature_type as string;
            const coordinates = union(
                featureCollection(e.deletedFeatures as Feature<Polygon>[]),
            );

            if (
                coordinates == null ||
                coordinates.geometry.type !== "Polygon"
            ) {
                notification.error({
                    message: "Unable to combine areas. Do they overlap?",
                });
                setFeatures({ ...features }); // revert
                return;
            }

            const mergedFeature = {
                id: "",
                properties: firstDeleted.properties,
                geometry: coordinates.geometry,
                type: "Feature",
            } as Feature<Polygon>;

            setFeatures((currFeatures) => {
                const newFeatures = { ...currFeatures };
                for (const f of e.deletedFeatures) {
                    delete newFeatures[f.id as string];
                }

                let type: string;
                let constructFn: (id: string) => MowingFeatureBase | null;

                switch (areaType) {
                    case "workarea":
                        type = "area";
                        constructFn = (id) =>
                            new MowingAreaFeature(id, mowingAreas.length + 1);
                        break;
                    case "navigation":
                        type = "navigation";
                        constructFn = (id) => new NavigationFeature(id);
                        break;
                    case "obstacle": {
                        type = "area";
                        const currentLayerCoordinates =
                            mergedFeature.geometry.coordinates[0];
                        const area = Object.values<MowingFeature>(
                            newFeatures,
                        ).find((f) => {
                            if (!(f instanceof MowingAreaFeature)) return false;
                            const areaCoordinates = f.geometry.coordinates[0];
                            return inside(
                                currentLayerCoordinates,
                                areaCoordinates,
                            );
                        });
                        if (!area) {
                            notification.info({
                                message:
                                    "Unable to match an area for this obstacle",
                            });
                            return features; // revert
                        }
                        constructFn = (id) =>
                            new ObstacleFeature(id, area as MowingAreaFeature);
                        break;
                    }
                    default:
                        notification.error({
                            message: `Unknown type ${areaType}`,
                        });
                        return features; // revert
                }

                const component = areaType === "obstacle" ? "obstacle" : "area";
                const id = getNewId(newFeatures, type, null, component);
                const nfeat = constructFn(id);
                if (!nfeat) return features; // revert
                nfeat.setGeometry(mergedFeature.geometry);
                newFeatures[id] = nfeat;
                sortFeatures(newFeatures);
                return newFeatures;
            });
        },
        [features, mowingAreas.length, notification, setFeatures],
    );

    const onDelete = useCallback(
        (e: { features: Feature[] }) => {
            setFeatures((currFeatures) => {
                const newFeatures = { ...currFeatures };
                for (const f of e.features) {
                    delete newFeatures[f.id as string];
                }
                return newFeatures;
            });
        },
        [setFeatures],
    );

    const onSelectionChange = useCallback(
        (e: { features: GeoJSON.Feature[] }) => {
            setSelectedFeatureIds(
                e.features.filter((f) => f.id != null).map((f) => String(f.id)),
            );
        },
        [],
    );

    const onOpenDetails = useCallback(
        (e: { feature?: Feature }) => {
            if (
                !features ||
                Object.keys(features).length === 0 ||
                !e ||
                !e.feature ||
                !e.feature.id
            )
                return;
            const mapfeature = e.feature as Feature<Polygon>;
            const ftype = mapfeature.properties?.feature_type;

            const feature =
                e.feature.id in features ? features[e.feature.id] : null;
            if (console.debug) console.debug("feature", feature);

            if (!feature || !(feature instanceof MowingFeatureBase)) {
                console.error("Feature not found", e.feature.id);
                notification.info({ message: "Feature not found" });
                return;
            }

            if (!isFeatureTypeArea(ftype)) {
                notification.info({ message: "Unable to edit this feature" });
                return;
            }
            setCurMowingAreaFeature(feature);
            setAreaModelOpen(true);
        },
        [features, notification],
    );

    // -----------------------------------------------------------------------
    // Toolbar handlers
    // -----------------------------------------------------------------------
    const handleEditSelectedFeature = useCallback(() => {
        if (selectedFeatureIds.length !== 1) return;
        const feat = features[selectedFeatureIds[0]];
        if (!feat) return;

        onOpenDetails({ feature: feat as Feature<Polygon> });
    }, [selectedFeatureIds, features, onOpenDetails]);

    const handleDrawPolygon = useCallback(() => {
        drawRef.current?.changeMode("draw_polygon");
    }, [drawRef]);

    const handleDrawShape = useCallback(
        (shape: ShapeType, sizeMeters: number) => {
            const map = mapInstanceRef.current;
            if (!map) return;
            const center = map.getCenter();

            const lat = center.lat;
            const metersPerDegreeLat = 111320;
            const metersPerDegreeLng = 111320 * Math.cos((lat * Math.PI) / 180);
            const halfW = sizeMeters / 2 / metersPerDegreeLng;
            const halfH = sizeMeters / 2 / metersPerDegreeLat;

            let coords: Position[];

            switch (shape) {
                case "square": {
                    coords = [
                        [center.lng - halfW, center.lat - halfH],
                        [center.lng + halfW, center.lat - halfH],
                        [center.lng + halfW, center.lat + halfH],
                        [center.lng - halfW, center.lat + halfH],
                        [center.lng - halfW, center.lat - halfH],
                    ];
                    break;
                }
                case "circle": {
                    const points = 32;
                    coords = Array.from({ length: points }, (_, i) => {
                        const angle = (i / points) * 2 * Math.PI;
                        return [
                            center.lng + halfW * Math.cos(angle),
                            center.lat + halfH * Math.sin(angle),
                        ];
                    });
                    coords.push(coords[0]);
                    break;
                }
                case "hexagon": {
                    coords = [];
                    for (let i = 0; i < 6; i++) {
                        const angle = (i / 6) * 2 * Math.PI;
                        coords.push([
                            center.lng + halfW * Math.cos(angle),
                            center.lat + halfH * Math.sin(angle),
                        ]);
                    }
                    coords.push(coords[0]);
                    break;
                }
            }

            const feature: Feature<Polygon> = {
                type: "Feature",
                properties: {},
                geometry: { type: "Polygon", coordinates: [coords] },
            };

            if (drawRef.current) {
                const ids = drawRef.current.add(feature);
                const added = drawRef.current.get(ids[0]);
                if (added) {
                    setCurrentFeature(added);
                    setModalOpen(true);
                }
            }
        },
        [drawRef, mapInstanceRef],
    );

    const handleDrawEmoji = useCallback(
        (emoji: string, sizeMeters: number) => {
            const map = mapInstanceRef.current;
            if (!map) return;

            const outline = emojiToPolygon(emoji);
            if (!outline || outline.length < 4) {
                notification.error({
                    message: "Could not trace a shape from this emoji",
                });
                return;
            }

            const center = map.getCenter();
            const lat = center.lat;
            const metersPerDegreeLat = 111320;
            const metersPerDegreeLng = 111320 * Math.cos((lat * Math.PI) / 180);
            const scaleW = sizeMeters / metersPerDegreeLng;
            const scaleH = sizeMeters / metersPerDegreeLat;

            const coords: Position[] = outline.map((p) => [
                center.lng + p[0] * scaleW,
                center.lat + p[1] * scaleH,
            ]);

            const feature: Feature<Polygon> = {
                type: "Feature",
                properties: {},
                geometry: { type: "Polygon", coordinates: [coords] },
            };

            if (drawRef.current) {
                const ids = drawRef.current.add(feature);
                const added = drawRef.current.get(ids[0]);
                if (added) {
                    setCurrentFeature(added);
                    setModalOpen(true);
                }
            }
        },
        [drawRef, mapInstanceRef, notification],
    );

    const handleTrash = useCallback(() => {
        drawRef.current?.trash();
    }, [drawRef]);

    const handleCombine = useCallback(() => {
        drawRef.current?.combineFeatures();
    }, [drawRef]);

    const handleAreaSelect = useCallback(
        (id: string) => {
            if (!editMap || !drawRef.current) return;
            drawRef.current.changeMode("simple_select", { featureIds: [id] });
            setSelectedFeatureIds([id]);
        },
        [editMap, drawRef],
    );

    const handleSubtract = useCallback(() => {
        if (selectedFeatureIds.length !== 2) {
            notification.info({
                message: "Select exactly 2 areas to subtract",
            });
            return;
        }
        const [keepId, cutId] = selectedFeatureIds;
        const keepFeat = features[keepId];
        const cutFeat = features[cutId];
        if (
            !keepFeat ||
            !cutFeat ||
            !(keepFeat instanceof MowingFeatureBase) ||
            !(cutFeat instanceof MowingFeatureBase)
        ) {
            notification.error({
                message: "Both selections must be polygon areas",
            });
            return;
        }

        const result = difference(
            featureCollection([keepFeat as any, cutFeat as any]),
        );
        if (!result || result.geometry.type !== "Polygon") {
            notification.error({
                message:
                    "Subtract failed — areas may not overlap, or result is not a simple polygon",
            });
            return;
        }

        setFeatures((curr) => {
            const next = { ...curr };
            const feat = next[keepId];
            if (feat && feat instanceof MowingFeatureBase) {
                feat.setGeometry(result.geometry as Polygon);
            }
            return next;
        });

        if (drawRef.current) {
            const drawFeat = drawRef.current.get(keepId);
            if (drawFeat) {
                drawFeat.geometry = result.geometry;
                drawRef.current.add(drawFeat);
            }
            drawRef.current.changeMode("simple_select", {
                featureIds: [keepId],
            });
        }
        notification.success({ message: "Area subtracted" });
    }, [selectedFeatureIds, features, notification, setFeatures, drawRef]);

    const handleSplit = useCallback(() => {
        if (selectedFeatureIds.length !== 1) {
            notification.info({ message: "Select exactly 1 area to split" });
            return;
        }
        const targetId = selectedFeatureIds[0];
        const feat = features[targetId];
        if (!feat || !(feat instanceof MowingFeatureBase)) {
            notification.error({ message: "Selection must be a polygon area" });
            return;
        }
        setSplitTargetId(targetId);
        notification.info({
            message: "Draw a line across the area to split it",
        });
        drawRef.current?.changeMode("split_line" as any);
    }, [selectedFeatureIds, features, notification, drawRef]);

    // -----------------------------------------------------------------------
    // Modal handlers
    // -----------------------------------------------------------------------
    const handleSaveNewArea = useCallback(
        (area: MapArea, newAreaType: FeatureTypeAreas) => {
            switch (newAreaType) {
                case "workarea":
                    setFeatures((currFeatures) => {
                        const id = getNewId(currFeatures, "area", null, "area");

                        const cleanedArea = {
                            ...area,
                            Name: area.Name?.trim() || area.Name,
                        };
                        const new_feature = new MowingAreaFeature(
                            id,
                            mowingAreas.length + 1,
                            cleanedArea,
                        );
                        if (
                            currentFeature &&
                            currentFeature.geometry.type === "Polygon"
                        ) {
                            new_feature.setGeometry(
                                (currentFeature as Feature<Polygon>).geometry,
                            );
                        }
                        return { ...currFeatures, [id]: new_feature };
                    });
                    setCurrentFeature(undefined);
                    setModalOpen(false);
                    break;
                case "navigation":
                    addNavigationArea();
                    break;
                case "obstacle":
                    addObstacle();
                    break;
                default:
                    notification.error({
                        message: `Unknown area type ${newAreaType}`,
                    });
            }
            // addNavigationArea / addObstacle capture state via closure — intentional
            // eslint-disable-next-line react-hooks/exhaustive-deps
        },
        [currentFeature, mowingAreas.length, setFeatures],
    );

    const deleteFeature = useCallback(() => {
        console.debug("Deleting feature", currentFeature);
        if (!currentFeature) return;
        setFeatures((currFeatures) => {
            const newFeatures = { ...currFeatures };
            delete newFeatures[currentFeature.id as string];
            return newFeatures;
        });
        setCurrentFeature(undefined);
        setModalOpen(false);
    }, [currentFeature, setFeatures]);

    const handleUpdateArea = useCallback(
        (area: MapArea) => {
            if (!curMowingAreaFeature || !curMowingAreaFeature.id) return;

            setAreaModelOpen(false);
            const newFeatures = { ...features } as Record<
                string,
                MowingFeature
            >;
            const oldFeature = newFeatures[curMowingAreaFeature.id];
            if (!oldFeature || !(oldFeature instanceof MowingFeatureBase))
                return;

            oldFeature.setPropertiesFromArea(area);

            setFeatures(newFeatures);
        },
        [curMowingAreaFeature, features, setFeatures],
    );

    const cancelNewAreaModal = useCallback(() => {
        setModalOpen(false);
        setCurrentFeature(undefined);
        if (drawRef.current) {
            drawRef.current.changeMode("simple_select");
            if (currentFeature?.id)
                drawRef.current.delete(currentFeature?.id as string);
        }
    }, [setFeatures]);

    const cancelAreaModal = useCallback(() => {
        setAreaModelOpen(false);
    }, []);

    // -----------------------------------------------------------------------
    // Return
    // -----------------------------------------------------------------------
    return {
        // State
        modalOpen,
        setModalOpen,
        areaModelOpen,
        setAreaModelOpen,
        currentFeature,
        setCurrentFeature,
        curMowingAreaFeature,
        selectedFeatureIds,
        setSelectedFeatureIds,
        splitTargetId,

        // Labels
        buildLabels,

        // Draw events
        onCreate,
        onUpdate,
        onCombine,
        onDelete,
        onSelectionChange,
        onOpenDetails,

        // Toolbar actions
        handleEditSelectedFeature,
        handleDrawPolygon,
        handleDrawShape,
        handleDrawEmoji,
        handleTrash,
        handleCombine,
        handleAreaSelect,
        handleSubtract,
        handleSplit,

        // Modal actions
        handleSaveNewArea,
        updateMowingArea: handleUpdateArea,
        cancelNewAreaModal,
        cancelAreaModal,
        deleteFeature,
    };
}
