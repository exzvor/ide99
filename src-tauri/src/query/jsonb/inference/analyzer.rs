//! Pure JSONB schema inference: a list of `serde_json::Value` samples
//! collapses into an `InferredSchema` (flat list of paths + types +
//! frequencies + top-3 sample values).
//!
//! Knows nothing about Postgres, `SQLite`, or Tauri. The walk is recursive
//! over JSON depth — pathologically deep input would stack-overflow; the
//! sampler (T6) caps the input shape and is the only intended caller.

use std::collections::{BTreeMap, HashSet};

use serde_json::Value;

use super::types::{InferredNode, InferredSchema, PathSegment, Primitive, ProbableType};

const ENUM_MAX_DISTINCT: usize = 8;
const SAMPLE_CAP: usize = 3;

#[must_use]
pub fn analyze(samples: &[Value]) -> InferredSchema {
    let mut acc: BTreeMap<Vec<PathSegment>, NodeAcc> = BTreeMap::new();
    #[allow(clippy::cast_possible_truncation)]
    let total = samples.len() as u32;

    for sample in samples {
        let mut seen_paths_this_row: HashSet<Vec<PathSegment>> = HashSet::new();
        walk(sample, &[], &mut acc, &mut seen_paths_this_row);
    }

    let mut nodes: Vec<InferredNode> = acc
        .into_iter()
        .map(|(path, a)| InferredNode {
            path,
            kind: a.finalize_kind(),
            #[allow(clippy::cast_precision_loss)]
            freq: if total == 0 {
                0.0
            } else {
                a.presence as f32 / total as f32
            },
            samples: a.samples.into_iter().take(SAMPLE_CAP).collect(),
        })
        .collect();

    nodes.sort_by(|a, b| {
        a.path
            .len()
            .cmp(&b.path.len())
            .then_with(|| a.path.cmp(&b.path))
    });

    InferredSchema {
        nodes,
        sample_count: total,
        generated_at: chrono::Utc::now().timestamp_millis(),
    }
}

// ---------- internals ----------

#[derive(Default)]
struct NodeAcc {
    presence: u32,
    string_distinct: HashSet<String>,
    string_overflowed: bool,
    observed: HashSet<TypeTag>,
    samples: Vec<Value>,
    element_acc: Option<Box<NodeAcc>>,
    /// fix: when this `NodeAcc` represents an array element
    /// (either the parent's `element_acc` slot or a `[*]`-suffixed wildcard
    /// child node), enum detection is suppressed — array elements always
    /// finalize to `Primitive(String)`. Object keys still get enum detection
    /// because their cardinality has semantic meaning ("event in {login,
    /// logout, purchase}"), whereas an array's element type is intrinsically
    /// a sequence and "array of enum" is misleading.
    skip_enum: bool,
}

#[derive(Hash, Eq, PartialEq, Clone, Copy)]
enum TypeTag {
    String,
    Number,
    Boolean,
    Null,
    Object,
    Array,
}

impl NodeAcc {
    fn finalize_kind(&self) -> ProbableType {
        if self.observed.is_empty() {
            // No primitive/object/array tags ever recorded. Reachable for an
            // `element_acc` belonging to an array whose every observed instance
            // was empty — fall back to Null sentinel so we never emit
            // `Union { variants: [] }` to the wire.
            return ProbableType::Primitive {
                value: Primitive::Null,
            };
        }
        let mut tags: Vec<TypeTag> = self.observed.iter().copied().collect();
        tags.sort_by_key(|t| *t as u8);

        if tags.len() == 1 {
            return self.kind_from_single_tag(tags[0]);
        }
        let variants: Vec<ProbableType> = tags
            .into_iter()
            .map(|t| self.kind_from_single_tag(t))
            .collect();
        ProbableType::Union { variants }
    }

    fn kind_from_single_tag(&self, t: TypeTag) -> ProbableType {
        match t {
            TypeTag::String => {
                if self.skip_enum || self.string_overflowed {
                    ProbableType::Primitive {
                        value: Primitive::String,
                    }
                } else {
                    debug_assert!(                        self.string_distinct.len() <= ENUM_MAX_DISTINCT,
                        "string_distinct must not exceed ENUM_MAX_DISTINCT while !string_overflowed"
);
                    let mut values: Vec<String> = self.string_distinct.iter().cloned().collect();
                    values.sort();
                    ProbableType::Enum { values }
                }
            }
            TypeTag::Number => ProbableType::Primitive {
                value: Primitive::Number,
            },
            TypeTag::Boolean => ProbableType::Primitive {
                value: Primitive::Boolean,
            },
            TypeTag::Null => ProbableType::Primitive {
                value: Primitive::Null,
            },
            TypeTag::Object => ProbableType::Object,
            TypeTag::Array => {
                let element = self.element_acc.as_ref().map_or_else(
                    || {
                        Box::new(ProbableType::Primitive {
                            value: Primitive::Null,
                        })
                    },
                    |e| Box::new(e.finalize_kind()),
                );
                ProbableType::Array { element }
            }
        }
    }

    fn record_sample(&mut self, v: &Value) {
        if self.samples.len() >= SAMPLE_CAP {
            return;
        }
        if !self.samples.iter().any(|existing| existing == v) {
            self.samples.push(v.clone());
        }
    }
}

fn walk(
    value: &Value,
    path: &[PathSegment],
    acc: &mut BTreeMap<Vec<PathSegment>, NodeAcc>,
    seen: &mut HashSet<Vec<PathSegment>>,
) {
    {
        let entry = acc.entry(path.to_owned()).or_default();
        // fix: any path whose tail segment is `ArrayWildcard`
        // (i.e. a `[*]` wildcard child node — the user-visible row for an
        // array's element type) suppresses enum detection so array<string>
        // elements stay `Primitive(String)`, never `Enum`.
        if matches!(path.last(), Some(PathSegment::ArrayWildcard)) {
            entry.skip_enum = true;
        }
        let first_time_in_row = seen.insert(path.to_owned());
        if first_time_in_row {
            entry.presence += 1;
        }

        match value {
            Value::Null => {
                entry.observed.insert(TypeTag::Null);
                entry.record_sample(value);
            }
            Value::Bool(_) => {
                entry.observed.insert(TypeTag::Boolean);
                entry.record_sample(value);
            }
            Value::Number(_) => {
                entry.observed.insert(TypeTag::Number);
                entry.record_sample(value);
            }
            Value::String(s) => {
                entry.observed.insert(TypeTag::String);
                if !entry.string_overflowed {
                    if entry.string_distinct.len() < ENUM_MAX_DISTINCT
                        || entry.string_distinct.contains(s)
                    {
                        entry.string_distinct.insert(s.clone());
                    } else {
                        entry.string_overflowed = true;
                        entry.string_distinct.clear();
                    }
                }
                entry.record_sample(value);
            }
            Value::Object(_) => {
                entry.observed.insert(TypeTag::Object);
            }
            Value::Array(items) => {
                entry.observed.insert(TypeTag::Array);
                if entry.element_acc.is_none() {
                    let mut e = Box::new(NodeAcc::default());
                    // fix: same suppression applies to the
                    // parent's element_acc slot (which feeds Array.element).
                    e.skip_enum = true;
                    entry.element_acc = Some(e);
                }
                // Seed element_acc with kinds from this batch of items
                for item in items {
                    let elem_acc = entry.element_acc.as_mut().expect("just seeded");
                    match item {
                        Value::Null => {
                            elem_acc.observed.insert(TypeTag::Null);
                        }
                        Value::Bool(_) => {
                            elem_acc.observed.insert(TypeTag::Boolean);
                        }
                        Value::Number(_) => {
                            elem_acc.observed.insert(TypeTag::Number);
                        }
                        Value::String(s) => {
                            elem_acc.observed.insert(TypeTag::String);
                            if !elem_acc.string_overflowed {
                                if elem_acc.string_distinct.len() < ENUM_MAX_DISTINCT
                                    || elem_acc.string_distinct.contains(s)
                                {
                                    elem_acc.string_distinct.insert(s.clone());
                                } else {
                                    elem_acc.string_overflowed = true;
                                    elem_acc.string_distinct.clear();
                                }
                            }
                        }
                        Value::Object(_) => {
                            elem_acc.observed.insert(TypeTag::Object);
                        }
                        Value::Array(_) => {
                            elem_acc.observed.insert(TypeTag::Array);
                        }
                    }
                }
            }
        }
    } // entry borrow dropped here

    // Recurse outside the borrow scope
    match value {
        Value::Object(map) => {
            for (k, v) in map {
                let mut next = path.to_owned();
                next.push(PathSegment::Key(k.clone()));
                walk(v, &next, acc, seen);
            }
        }
        Value::Array(items) => {
            for item in items {
                let mut next = path.to_owned();
                next.push(PathSegment::ArrayWildcard);
                walk(item, &next, acc, seen);
            }
        }
        _ => {}
    }
}

// ----------------- tests -----------------

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn p(parts: &[&str]) -> Vec<PathSegment> {
        parts
            .iter()
            .map(|s| PathSegment::Key((*s).into()))
            .collect()
    }

    fn find<'a>(s: &'a InferredSchema, path: &[PathSegment]) -> Option<&'a InferredNode> {
        s.nodes.iter().find(|n| n.path == path)
    }

    #[test]
    fn flat_object_keys_with_freq() {
        let samples = vec![
            json!({"a": 1, "b": "x"}),
            json!({"a": 2, "b": "y"}),
            json!({"a": 3}),
        ];
        let s = analyze(&samples);
        assert_eq!(s.sample_count, 3);
        assert!((find(&s, &p(&["a"])).unwrap().freq - 1.0).abs() < 0.001);
        assert!((find(&s, &p(&["b"])).unwrap().freq - (2.0 / 3.0)).abs() < 0.01);
    }

    #[test]
    fn enum_detection_for_few_distinct_strings() {
        let samples: Vec<_> = (0..50)
            .map(|i| json!({"event": if i % 2 == 0 { "login" } else { "logout" }}))
            .collect();
        let s = analyze(&samples);
        let node = find(&s, &p(&["event"])).unwrap();
        match &node.kind {
            ProbableType::Enum { values } => {
                assert!(values.contains(&"login".to_string()));
                assert!(values.contains(&"logout".to_string()));
            }
            other => panic!("expected Enum, got {other:?}"),
        }
    }

    #[test]
    fn enum_overflow_falls_back_to_string() {
        let samples: Vec<_> = (0..20).map(|i| json!({"id": format!("u_{i}")})).collect();
        let s = analyze(&samples);
        let node = find(&s, &p(&["id"])).unwrap();
        assert!(matches!(
            node.kind,
            ProbableType::Primitive {
                value: Primitive::String
            }
        ));
    }

    #[test]
    fn nested_object_path() {
        let samples = vec![json!({"prefs": {"theme": "dark"}})];
        let s = analyze(&samples);
        assert!(find(&s, &p(&["prefs"])).is_some());
        assert!(find(&s, &p(&["prefs", "theme"])).is_some());
    }

    #[test]
    fn array_wildcard_segment_used_for_elements() {
        let samples = vec![json!({"tags": ["a", "b", "c"]})];
        let s = analyze(&samples);
        let arr = find(&s, &p(&["tags"])).unwrap();
        assert!(matches!(arr.kind, ProbableType::Array { .. }));
        let elem_path = vec![PathSegment::Key("tags".into()), PathSegment::ArrayWildcard];
        assert!(find(&s, &elem_path).is_some());
    }

    #[test]
    fn array_of_strings_yields_primitive_not_enum() {
        // regression: `tags` was previously inferred as
        // Array<Enum>, even though arrays of repeated string values are
        // semantically `array<string>` (the cardinality bound carries no
        // useful UX signal for arrays).
        let samples = vec![
            json!({"tags": ["premium", "verified"]}),
            json!({"tags": ["premium", "verified"]}),
            json!({"tags": ["premium", "verified"]}),
        ];
        let s = analyze(&samples);

        // Parent `tags` row: must show as Array<Primitive(String)>.
        let tags = find(&s, &p(&["tags"])).expect("tags node present");
        match &tags.kind {
            ProbableType::Array { element } => {
                assert!(
                    matches!(
                        **element,
                        ProbableType::Primitive {
                            value: Primitive::String
                        }
                    ),
                    "expected Array<Primitive(String)>, got Array<{element:?}>"
                );
            }
            other => panic!("expected Array kind, got {other:?}"),
        }

        // Wildcard child `[tags, *]`: must be Primitive(String), not Enum.
        let wildcard_path = vec![PathSegment::Key("tags".into()), PathSegment::ArrayWildcard];
        let wildcard = find(&s, &wildcard_path).expect("wildcard child present");
        assert!(
            matches!(
                wildcard.kind,
                ProbableType::Primitive {
                    value: Primitive::String
                }
            ),
            "expected wildcard child Primitive(String), got {:?}",
            wildcard.kind,
        );
    }

    #[test]
    fn array_of_objects_introspects_keys() {
        let samples = vec![json!({"items": [{"price": 10}, {"price": 20}]})];
        let s = analyze(&samples);
        let elem_path = vec![
            PathSegment::Key("items".into()),
            PathSegment::ArrayWildcard,
            PathSegment::Key("price".into()),
        ];
        let node = find(&s, &elem_path).unwrap();
        assert!(matches!(
            node.kind,
            ProbableType::Primitive {
                value: Primitive::Number
            }
        ));
    }

    #[test]
    fn mixed_primitive_types_become_union() {
        let samples = vec![json!({"x": 1}), json!({"x": "str"}), json!({"x": true})];
        let s = analyze(&samples);
        let node = find(&s, &p(&["x"])).unwrap();
        assert!(matches!(node.kind, ProbableType::Union { .. }));
    }

    #[test]
    fn samples_capped_at_three_distinct() {
        let samples: Vec<_> = (0..10).map(|i| json!({"n": i})).collect();
        let s = analyze(&samples);
        let node = find(&s, &p(&["n"])).unwrap();
        assert!(node.samples.len() <= 3);
    }

    #[test]
    fn empty_input_yields_empty_schema() {
        let s = analyze(&[]);
        assert!(s.nodes.is_empty());
        assert_eq!(s.sample_count, 0);
    }

    #[test]
    fn scalar_root_emits_root_node() {
        let samples = vec![json!(42), json!(43), json!(44)];
        let s = analyze(&samples);
        let root = find(&s, &[]).unwrap();
        assert!(matches!(
            root.kind,
            ProbableType::Primitive {
                value: Primitive::Number
            }
        ));
        assert!((root.freq - 1.0).abs() < 0.001);
    }

    #[test]
    fn freq_in_unit_interval_for_arbitrary_input() {
        let samples = vec![
            json!({"a": 1}),
            json!({"b": 2}),
            json!([1, 2, 3]),
            json!(null),
        ];
        let s = analyze(&samples);
        for node in &s.nodes {
            assert!(
                node.freq >= 0.0 && node.freq <= 1.0,
                "freq={}, path={:?}",
                node.freq,
                node.path
            );
        }
    }

    #[test]
    fn presence_counted_once_per_row_even_in_arrays() {
        let samples = vec![json!({"items": [{"k": 1}, {"k": 2}, {"k": 3}, {"k": 4}, {"k": 5}]})];
        let s = analyze(&samples);
        let path = vec![
            PathSegment::Key("items".into()),
            PathSegment::ArrayWildcard,
            PathSegment::Key("k".into()),
        ];
        let node = find(&s, &path).unwrap();
        assert!((node.freq - 1.0).abs() < 0.001);
    }

    #[test]
    fn empty_array_element_does_not_produce_empty_union() {
        use serde_json::json;
        let samples = vec![json!({"tags": []})];
        let s = analyze(&samples);
        let arr = find(&s, &p(&["tags"])).expect("array node present");
        match &arr.kind {
            ProbableType::Array { element } => {
                // The element kind should be a sentinel — not Union { variants: [] }.
                // Plan calls for Primitive(Null) as the unobserved-element fallback.
                assert!(
                    matches!(
                        **element,
                        ProbableType::Primitive {
                            value: Primitive::Null
                        }
                    ),
                    "expected Primitive(Null) for empty-array element, got {element:?}"
                );
            }
            other => panic!("expected Array kind, got {other:?}"),
        }
        // Also assert that the wildcard child node is NOT present (no elements were
        // walked, so no [tags, *] path should be in the schema).
        let wildcard_path = vec![PathSegment::Key("tags".into()), PathSegment::ArrayWildcard];
        assert!(
            s.nodes.iter().all(|n| n.path != wildcard_path),
            "expected no wildcard child for empty array"
        );
    }

    use proptest::prelude::*;

    fn arb_value() -> impl Strategy<Value = Value> {
        let leaf = prop_oneof![
            Just(Value::Null),
            any::<bool>().prop_map(Value::Bool),
            any::<i32>().prop_map(|n| json!(n)),
            ".*".prop_map(Value::String),
        ];
        leaf.prop_recursive(3, 16, 4, |inner| {
            prop_oneof![
                prop::collection::vec(inner.clone(), 0..4).prop_map(Value::Array),
                prop::collection::hash_map("[a-z]{1,4}", inner, 0..4)
                    .prop_map(|m| Value::Object(m.into_iter().collect())),
            ]
        })
    }

    proptest! {
        #[test]
        fn never_panics_and_preserves_invariants(samples in prop::collection::vec(arb_value(), 0..20)) {
            let schema = analyze(&samples);
            for node in &schema.nodes {
                prop_assert!(node.freq >= 0.0 && node.freq <= 1.0);
                prop_assert!(node.samples.len() <= SAMPLE_CAP);
            }
            // path uniqueness invariant
            let mut seen = std::collections::HashSet::new();
            for node in &schema.nodes {
                prop_assert!(seen.insert(node.path.clone()), "duplicate path {:?}", node.path);
            }
        }
    }
}
