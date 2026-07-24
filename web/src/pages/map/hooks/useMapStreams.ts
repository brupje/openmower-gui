import React, { useEffect, useState } from "react";
import type { Map as MapboxMap } from "mapbox-gl";
import { useWS } from "../../../hooks/useWS.ts";
import { useHighLevelStatus } from "../../../hooks/useHighLevelStatus.ts";
import {
    AbsolutePose,
    LaserScan,
    Map as MapType,
    MarkerArray,
    Path,
} from "../../../types/ros.ts";
import {
    LineFeatureBase,
    MowingFeature,
    MowerFeatureBase,
    PathFeature,
} from "../../../types/map.ts";
import { drawLine, transpose } from "../../../utils/map.tsx";

interface UseMapStreamsOptions {
    editMap: boolean;
    settings: Record<string, string>;
    offsetX: number;
    offsetY: number;
    datum: [number, number, number];
    mowingToolWidth: number;
    setFeatures: React.Dispatch<React.SetStateAction<Record<string, MowingFeature>>>;
    setEditMap: React.Dispatch<React.SetStateAction<boolean>>;
    setMapKey: React.Dispatch<React.SetStateAction<string>>;
    mapInstanceRef: React.RefObject<MapboxMap | null>;
    robotPoseRef: React.RefObject<{ x: number; y: number; heading: number } | null>;
}

export function useMapStreams({
    editMap,
    settings,
    offsetX,
    offsetY,
    datum,
    mowingToolWidth,
    setFeatures,
    setEditMap,
    setMapKey,
    mapInstanceRef,
    robotPoseRef,
}: UseMapStreamsOptions) {
    const [map, setMap] = useState<MapType | undefined>(undefined);
    const [path, setPath] = useState<MarkerArray | undefined>(undefined);
    const [plan, setPlan] = useState<Path | undefined>(undefined);
    const [lidarCollection, setLidarCollection] = useState<GeoJSON.FeatureCollection>({
        type: "FeatureCollection",
        features: [],
    });
    const [mowerPose, setMowerPose] = useState<{ mower: MowerFeatureBase; heading: LineFeatureBase } | null>(null);

    const highLevelStatus = useHighLevelStatus();

    const poseStream = useWS<string>(
        () => {
            console.log({ message: "Pose Stream closed" });
        },
        () => {
            console.log({ message: "Pose Stream connected" });
        },
        (e) => {
            const pose = JSON.parse(e) as AbsolutePose;
            const mower_lonlat = transpose(
                offsetX,
                offsetY,
                datum,
                pose.Pose?.Pose?.Position?.Y!!,
                pose.Pose?.Pose?.Position?.X!!
            );
            robotPoseRef.current = {
                x: pose.Pose?.Pose?.Position?.X ?? 0,
                y: pose.Pose?.Pose?.Position?.Y ?? 0,
                heading: pose.MotionHeading ?? 0,
            };

            const orientation = pose.MotionHeading!!;
                const line = drawLine(
                    offsetX,
                    offsetY,
                    datum,
                    pose.Pose?.Pose?.Position?.Y!!,
                    pose.Pose?.Pose?.Position?.X!!,
                    orientation
                );

            setMowerPose({
                mower: new MowerFeatureBase(mower_lonlat),
                heading: new LineFeatureBase("mower-heading", [mower_lonlat, line], "#ff0000", "heading")
            });
            
        }
    );

    const mapStream = useWS<string>(
        () => {
            console.log({ message: "MAP Stream closed" });
        },
        () => {
            console.log({ message: "MAP Stream connected" });
        },
        (e) => {
            const parse = JSON.parse(e) as MapType;
            if (console.debug) console.debug(parse);

            if (console.debug)
                console.debug("New map", parse);

            setMap(parse);
            setMapKey("live");
        }
    );

    const pathStream = useWS<string>(
        () => {
            console.log({ message: "PATH Stream closed" });
        },
        () => {
            console.log({ message: "PATH Stream connected" });
        },
        (e) => {
            const parse = JSON.parse(e) as MarkerArray;
            setPath(parse);
        }
    );

    const planStream = useWS<string>(
        () => {
            console.log({ message: "PLAN Stream closed" });
        },
        () => {
            console.log({ message: "PLAN Stream connected" });
        },
        (e) => {
            const parse = JSON.parse(e) as Path;
            setPlan(parse);
        }
    );

    const mowingPathStream = useWS<string>(
        () => {
            console.log({ message: "Mowing PATH Stream closed" });
        },
        () => {
            console.log({ message: "Mowing PATH Stream connected" });
        },
        (e) => {
            const mowingPaths = JSON.parse(e) as Path[];
            setFeatures((oldFeatures) => {
                const newFeatures = { ...oldFeatures };
                mowingPaths.forEach((mowingPath, index) => {
                    if (mowingPath?.Poses) {
                        const line = mowingPath.Poses.map((pose) => {
                            return transpose(
                                offsetX,
                                offsetY,
                                datum,
                                pose.Pose?.Position?.Y!,
                                pose.Pose?.Position?.X!
                            );
                        });
                        newFeatures["mowingPath-" + index.toString()] = new PathFeature(
                            "mowingPath-" + index.toString(),
                            line,
                            `rgba(107, 255, 188, 0.68)`,
                            mowingToolWidth
                        );
                    }
                });
                return newFeatures;
            });
        }
    );

    const joyStream = useWS<string>(
        () => {
            console.log({ message: "Joystick Stream closed" });
        },
        () => {
            console.log({ message: "Joystick Stream connected" });
        },
        () => {}
    );

    const lidarStream = useWS<string>(
        () => {
            console.log({ message: "Lidar Stream closed" });
        },
        () => {
            console.log({ message: "Lidar Stream connected" });
        },
        (e) => {
            const scan = JSON.parse(e) as LaserScan;
            const pose = robotPoseRef.current;
            if (!pose || !scan.Ranges) return;

            const rays: GeoJSON.Feature[] = [];
            const angleMin = scan.AngleMin ?? 0;
            const angleInc = scan.AngleIncrement ?? 0;
            const rangeMin = scan.RangeMin ?? 0;
            const rangeMax = scan.RangeMax ?? 12;

            // Downsample: take every Nth point for performance
            const step = Math.max(1, Math.floor(scan.Ranges.length / 90));
            for (let i = 0; i < scan.Ranges.length; i += step) {
                const range = scan.Ranges[i];
                if (range < rangeMin || range > rangeMax) continue;

                const angle = angleMin + i * angleInc + pose.heading;
                const endX = pose.x + range * Math.cos(angle);
                const endY = pose.y + range * Math.sin(angle);
                const endLonLat = transpose(offsetX, offsetY, datum, endY, endX);

                rays.push({
                    type: "Feature",
                    properties: { intensity: range < rangeMax * 0.8 ? "hit" : "far" },
                    geometry: {
                        type: "Point",
                        coordinates: endLonLat,
                    },
                });
            }
            setLidarCollection({
                type: "FeatureCollection",
                features: rays,
            });
        }
    );

    // Keep lidar layer on top of draw layers
    useEffect(() => {
        const m = mapInstanceRef.current;
        if (!m) return;
        try {
            if (m.getLayer("lidar-points")) {
                m.moveLayer("lidar-points");
            }
        } catch { /* layer may not exist yet */ }
    }, [lidarCollection]);

    // Start/stop streams when editMap changes
    useEffect(() => {
        if (editMap) {
            mapStream.stop();
            poseStream.stop();
            pathStream.stop();
            planStream.stop();
            mowingPathStream.stop();
            lidarStream.stop();
            highLevelStatus.stop();
            setPath(undefined);
            setPlan(undefined);
            setLidarCollection({ type: "FeatureCollection", features: [] });
        } else {
            if (
                settings["OM_DATUM_LONG"] == undefined ||
                settings["OM_DATUM_LAT"] == undefined
            ) {
                return;
            }
            highLevelStatus.start("/api/openmower/subscribe/highLevelStatus");
            poseStream.start("/api/openmower/subscribe/pose");
            mapStream.start("/api/openmower/subscribe/map");
            pathStream.start("/api/openmower/subscribe/path");
            planStream.start("/api/openmower/subscribe/plan");
            mowingPathStream.start("/api/openmower/subscribe/mowingPath");
            lidarStream.start("/api/openmower/subscribe/lidar");
        }
    }, [editMap]);

    // Start joy stream on AREA_RECORDING state
    useEffect(() => {
        if (highLevelStatus.highLevelStatus.StateName == "AREA_RECORDING") {
            joyStream.start("/api/openmower/publish/joy");
            setEditMap(false);
            return;
        }
        joyStream.stop();
    }, [highLevelStatus.highLevelStatus.StateName]);

    // Restart all streams on settings change
    useEffect(() => {
        if (
            settings["OM_DATUM_LONG"] == undefined ||
            settings["OM_DATUM_LAT"] == undefined
        ) {
            return;
        }
        highLevelStatus.start("/api/openmower/subscribe/highLevelStatus");
        poseStream.start("/api/openmower/subscribe/pose");
        mapStream.start("/api/openmower/subscribe/map");
        pathStream.start("/api/openmower/subscribe/path");
        planStream.start("/api/openmower/subscribe/plan");
        mowingPathStream.start("/api/openmower/subscribe/mowingPath");
        lidarStream.start("/api/openmower/subscribe/lidar");
    }, [settings]);

    // Cleanup all streams on unmount
    useEffect(() => {
        return () => {
            poseStream.stop();
            mapStream.stop();
            pathStream.stop();
            joyStream.stop();
            planStream.stop();
            mowingPathStream.stop();
            lidarStream.stop();
            highLevelStatus.stop();
        };
    }, []);

    return {
        map,
        setMap,
        path,
        plan,
        lidarCollection,
        highLevelStatus,
        joyStream,
        mowerPose
    };
}
