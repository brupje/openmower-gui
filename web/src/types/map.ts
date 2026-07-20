import type {
    BBox,
    Feature,
    Polygon,
    Point,
    Position,
    LineString,
} from "geojson";
import { MapArea, Point32 } from "../types/ros.ts";

import turfArea from "@turf/area";
import { dedupePoints, itranspose, transpose } from "../utils/map.tsx";
import { FeatureTypes } from "../pages/map/utils/types.ts";

export class MowingFeature implements Feature {
    id: string;
    type: "Feature";
    geometry: Polygon | Point | LineString;
    properties: Record<string, unknown>;

    constructor(id: string) {
        this.type = "Feature";
        this.id = id;
        this.geometry = { type: "Point", coordinates: [0, 0] };
        this.properties = {};
    }
}

export class PointFeatureBase extends MowingFeature implements Feature<Point> {
    geometry: Point;
    properties: {
        color: string;
        feature_type: string;
    };

    constructor(id: string, coordinate: Position, feature_type: string) {
        super(id);

        this.properties = {
            color: "black",
            feature_type: feature_type,
        };
        this.geometry = { type: "Point", coordinates: coordinate } as Point;
    }

    setColor(color: string) {
        this.properties.color = color;
    }
}

export class LineFeatureBase
    extends MowingFeature
    implements Feature<LineString>
{
    geometry: LineString;
    properties: {
        color: string;
        width: number;
        feature_type: string;
    };

    constructor(
        id: string,
        coordinates: Position[],
        color: string,
        feature_type: string,
    ) {
        super(id);

        this.properties = {
            color: color,
            width: 1,
            feature_type: feature_type,
        };
        this.geometry = {
            type: "LineString",
            coordinates: coordinates,
        } as LineString;
    }
}

export class PathFeature extends LineFeatureBase {
    constructor(
        id: string,
        coordinates: Position[],
        color: string,
        lineWidth = 1,
    ) {
        super(id, coordinates, color, "path");
        this.properties.width = lineWidth;
    }
}

export class ActivePathFeature extends LineFeatureBase {
    constructor(id: string, coordinates: Position[]) {
        super(id, coordinates, "orange", "active_path");
        this.properties.width = 3;
    }
}

export class MowerFeatureBase extends PointFeatureBase {
    constructor(coordinate: Position) {
        super("mower", coordinate, "mower");
        this.setColor("#00a6ff");
    }
}

export class DockFeatureBase extends PointFeatureBase {
    constructor(coordinate: Position) {
        super("dock", coordinate, "dock");
        this.setColor("#ff00f2");
    }
}

export class MowingFeatureBase
    extends MowingFeature
    implements Feature<Polygon>
{
    geometry: Polygon;

    properties: {
        color: string;
        active: boolean;
        name?: string;
        index: number;
        mowing_order: number;
        feature_type: FeatureTypes;
        outline_count?: number;
        outline_overlap_count?: number;
        outline_offset?: number;
        angle?: number;
    };
    bbox?: BBox | undefined;

    constructor(id: string, feature_type: FeatureTypes) {
        super(id);
        this.type = "Feature";
        this.properties = {
            color: "black",
            index: 0,
            mowing_order: 9999,
            feature_type: feature_type,
            active: true,
        };
        this.geometry = { type: "Polygon", coordinates: [] } as Polygon;
    }

    setActive(active: boolean) {
        this.properties.active = active;
    }

    setPropertiesFromArea(area: MapArea) {
        this.properties = {
            ...this.properties,
            active: area.Active ?? true,
            name: area.Name,
        };
    }

    getArea(): MapArea {
        return {
            Active: this.properties.active ?? false,
            Name: this.properties.name,
            OutlineCount: this.properties.outline_count,
            OutlineOverlapCount: this.properties.outline_overlap_count,
            OutlineOffset: this.properties.outline_offset,
            Angle: this.properties.angle,
        };
    }

    getProperties(
        offsetX: number,
        offsetY: number,
        datum: [number, number, number],
    ): MapArea {
        const rawPoints = this.geometry.coordinates[0].map((point) => {
            const p = itranspose(offsetX, offsetY, datum, point[1], point[0]);
            return { x: p[0], y: p[1], z: 0 };
        });
        const points = dedupePoints(rawPoints);
        const retval = { 
            Active: this.properties.active ?? true,
            Name: this.properties.name,
            OutlineCount: this.properties.outline_count??-1,
            OutlineOverlapCount: this.properties.outline_overlap_count??-1,
            OutlineOffset: this.properties.outline_offset,
            Angle: this.properties.angle??-1,
            Area: { Points: points as Point32[]}
        }

        return retval;
        
    }

    setGeometry(geometry: Polygon) {
        this.geometry = geometry;
    }

    transpose(
        points: Point32[],
        offsetX: number,
        offsetY: number,
        datum: [number, number, number],
    ) {
        this.geometry.coordinates = [
            points.map((point) => {
                return transpose(
                    offsetX,
                    offsetY,
                    datum,
                    point.Y || 0,
                    point.X || 0,
                );
            }),
        ];
    }

    setColor(color: string): MowingFeatureBase {
        this.properties.color = color;
        return this;
    }

    getSize() {
        const areaSqm = turfArea(this);
        return areaSqm >= 10000
            ? `${(areaSqm / 10000).toFixed(2)} ha`
            : `${areaSqm.toFixed(0)} m²`;
    }

    getFullLabel() {
        return this.getLabel() + `\n${this.getSize()}`;
    }

    getLabel() {
        return this.properties?.name ?? this.id;
    }

    setName(name: string): MowingFeatureBase {
        this.properties.name = name;
        return this;
    }

    getName(): string {
        return this.properties?.name ? this.properties?.name : "";
    }
}

export class ObstacleFeature extends MowingFeatureBase {
    mowing_area: MowingAreaFeature;

    constructor(id: string, mowing_area: MowingAreaFeature) {
        super(id, "obstacle");
        this.setColor("#bf0000");
        this.mowing_area = mowing_area;
    }

    getMowingArea(): MowingAreaFeature {
        return this.mowing_area;
    }
}

export class MapAreaFeature extends MowingFeatureBase {
    area?: MapArea;

    constructor(id: string, feature_type: FeatureTypes) {
        super(id, feature_type);
    }

    setArea(
        area: MapArea,
        offsetX: number,
        offsetY: number,
        datum: [number, number, number],
    ) {
        this.area = area;
        this.transpose(area.Area?.Points ?? [], offsetX, offsetY, datum);
    }
}

export class NavigationFeature extends MapAreaFeature {
    constructor(id: string) {
        super(id, "navigation");
        this.setColor("white");
    }
}

export class MowingAreaFeature extends MapAreaFeature {
    //mowing_order: number;

    constructor(id: string, mowing_order: number, area?: MapArea) {
        super(id, "workarea");
        this.properties.mowing_order = mowing_order;

        this.setName(area?.Name ?? "");
        this.setColor("#01d30d");
        if (area) {
            this.setPropertiesFromArea(area);
        }
    }

    setPropertiesFromArea(area: MapArea) {
        super.setPropertiesFromArea(area);
        this.properties = {
            ...this.properties,
            outline_count: area.OutlineCount == -1? undefined: area.OutlineCount,
            outline_overlap_count: area.OutlineOverlapCount  == -1? undefined: area.OutlineOverlapCount,
            outline_offset: area.OutlineOffset   ===undefined ? undefined: area.OutlineOffset,
            angle: area.Angle == -1? undefined: area.Angle,
        };
    }

    setArea(
        area: MapArea,
        offsetX: number,
        offsetY: number,
        datum: [number, number, number],
    ) {
        this.setPropertiesFromArea(area);
        super.setArea(area, offsetX, offsetY, datum);
        this.setName(area.Name ?? "");
    }

    setOutlineCount(count?: number): MowingAreaFeature {
        this.properties.outline_count = count;
        return this;
    }

    getOutlineCount(): number | undefined {
        return this.properties?.outline_count;
    }

    setOutlineOverlapCount(count?: number): MowingAreaFeature {
        this.properties.outline_overlap_count = count;
        return this;
    }

    getOutlineOverlapCount(): number | undefined {
        return this.properties?.outline_overlap_count;
    }

    setOutlineOffset(count?: number): MowingAreaFeature {
        this.properties.outline_offset = count;
        return this;
    }

    getOutlineOffset(): number | undefined {
        return this.properties?.outline_offset;
    }

    setAngle(angle?: number): MowingAreaFeature {
        this.properties.angle = angle;
        return this;
    }

    getAngle(): number | undefined {
        return this.properties?.angle;
    }

    getMowingOrder(): number {
        return this.properties.mowing_order;
    }

    setMowingOrder(val: number): MowingAreaFeature {
        this.properties.mowing_order = val;
        return this;
    }

    getIndex(): number {
        return this.properties.mowing_order - 1;
    }

    getLabel(): string {
        const name = this.getName();
        return name
            ? name + " (" + this.getMowingOrder().toString() + ")"
            : "Area " + this.getMowingOrder().toString();
    }
}
