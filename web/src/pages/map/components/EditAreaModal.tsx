import { Form, Input, Modal, Switch } from "antd";

import { WorkAreaFields } from "./WorkAreaField.tsx";
import { MapArea } from "../../../types/ros.ts";
import { useEffect, useState } from "react";
import { FeatureTypeAreas } from "../utils/types.ts";

interface EditAreaModalProps {
    open: boolean;
    area: MapArea;
    feature_type: FeatureTypeAreas;
    onSave: (area: MapArea) => void;
    onCancel: () => void;
}

export const EditAreaModal = ({
    open,
    feature_type,
    area,
    onSave,
    onCancel,
}: EditAreaModalProps) => {
    const [editarea, setArea] = useState<MapArea>(area);

    useEffect(() => {
        if (open) {
            if (console.debug)
                console.debug("editing", editarea);
            setArea(area);
        }
    }, [open]);

    return (
        <Modal
            open={open}
            title={editarea.Name ? `Edit2 "${editarea.Name}"` : "Edit area"}
            okText="Save"
            cancelText="Cancel"
            onOk={() => {
                onSave(editarea);
            }}
            onCancel={onCancel}
            destroyOnHidden
        >
            <Form layout="vertical" style={{ marginTop: 16 }}>
                <Form.Item label="Area name (optional)">
                    <Input
                        placeholder="e.g. Front lawn"
                        value={editarea?.Name}
                        onChange={(e) =>
                            setArea({ ...editarea, Name: e.target.value })
                        }
                        autoFocus
                    />
                </Form.Item>
                
                <Form.Item label="Active">
                    <Switch value={editarea?.Active??true} onChange={(v) => setArea({ ...editarea, Active: v })} />
                </Form.Item>
                {feature_type === "workarea" && (
                    <>
                        <WorkAreaFields area={editarea} setArea={setArea} />
                    </>
                )}
            </Form>
        </Modal>
    );
};
