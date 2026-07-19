export type FeatureTypeWorkArea = 'workarea';
export type FeatureTypeNavigation = 'navigation';
export type FeatureTypeObstacle = 'obstacle';
export type FeatureTypeDock = 'dock';
export type FeatureTypeAreas = FeatureTypeWorkArea | FeatureTypeNavigation | FeatureTypeObstacle;
export const FEATURE_TYPE_AREAS = ['workarea', 'navigation', 'obstacle'] as const;
export type FeatureTypes = FeatureTypeAreas | FeatureTypeDock;

export const isFeatureTypeArea = (type: string): type is FeatureTypeAreas => {
    return FEATURE_TYPE_AREAS.includes(type as FeatureTypeAreas);
};



export interface AreaListItem {
    id: string;
    name: string;
    ftype: string;
    areaLabel: string;
    mowingOrder?: number;
}
