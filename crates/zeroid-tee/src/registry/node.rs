/// TEE node registration, health monitoring, and management.
use crate::attestation::report::Platform;
use crate::error::{Result, ZeroIdTeeError};
use crate::registry::types::{NodeInfo, NodeStatus};

/// Registry of TEE nodes.
#[derive(Debug, Clone)]
pub struct NodeRegistry {
    /// Registered nodes.
    nodes: Vec<NodeInfo>,
    /// Heartbeat timeout in seconds — nodes that miss this are marked offline.
    heartbeat_timeout_secs: u64,
}

impl NodeRegistry {
    /// Create a new empty registry.
    pub fn new(heartbeat_timeout_secs: u64) -> Self {
        Self {
            nodes: Vec::new(),
            heartbeat_timeout_secs,
        }
    }

    /// Register a new node.  Returns an error if the node ID is already taken.
    pub fn register(
        &mut self,
        node_id: impl Into<String>,
        operator: [u8; 20],
        platform: Platform,
        enclave_hash: [u8; 32],
        now: u64,
    ) -> Result<()> {
        let node_id = node_id.into();
        if self.nodes.iter().any(|n| n.node_id == node_id) {
            return Err(ZeroIdTeeError::RegistryError(format!(
                "node already registered: {node_id}"
            )));
        }
        self.nodes.push(NodeInfo::new(
            node_id,
            operator,
            platform,
            enclave_hash,
            now,
        ));
        Ok(())
    }

    /// Look up a node by ID.
    pub fn get(&self, node_id: &str) -> Result<&NodeInfo> {
        self.nodes
            .iter()
            .find(|n| n.node_id == node_id)
            .ok_or_else(|| ZeroIdTeeError::NodeNotFound(node_id.into()))
    }

    /// Look up a node by ID (mutable).
    pub fn get_mut(&mut self, node_id: &str) -> Result<&mut NodeInfo> {
        self.nodes
            .iter_mut()
            .find(|n| n.node_id == node_id)
            .ok_or_else(|| ZeroIdTeeError::NodeNotFound(node_id.into()))
    }

    /// Record a heartbeat for a node.
    pub fn heartbeat(&mut self, node_id: &str, now: u64) -> Result<()> {
        let node = self.get_mut(node_id)?;
        node.heartbeat(now);
        Ok(())
    }

    /// Deregister a node.
    pub fn deregister(&mut self, node_id: &str) -> Result<()> {
        let node = self.get_mut(node_id)?;
        node.status = NodeStatus::Deregistered;
        Ok(())
    }

    /// Mark a node as degraded.
    pub fn mark_degraded(&mut self, node_id: &str) -> Result<()> {
        let node = self.get_mut(node_id)?;
        node.status = NodeStatus::Degraded;
        Ok(())
    }

    /// Run a health check across all nodes, marking stale ones as offline.
    ///
    /// Returns the number of nodes marked offline.
    pub fn health_check(&mut self, now: u64) -> usize {
        let timeout = self.heartbeat_timeout_secs;
        let mut count = 0;
        for node in &mut self.nodes {
            if (node.status == NodeStatus::Active || node.status == NodeStatus::Degraded)
                && !node.is_alive(now, timeout)
            {
                node.status = NodeStatus::Offline;
                count += 1;
            }
        }
        count
    }

    /// Return all nodes with a given status.
    pub fn nodes_with_status(&self, status: NodeStatus) -> Vec<&NodeInfo> {
        self.nodes.iter().filter(|n| n.status == status).collect()
    }

    /// Return all active or degraded nodes.
    pub fn available_nodes(&self) -> Vec<&NodeInfo> {
        self.nodes
            .iter()
            .filter(|n| n.status.is_available())
            .collect()
    }

    /// Return total number of registered nodes (including deregistered).
    pub fn total_count(&self) -> usize {
        self.nodes.len()
    }

    /// Return the heartbeat timeout.
    pub fn heartbeat_timeout(&self) -> u64 {
        self.heartbeat_timeout_secs
    }
}

impl Default for NodeRegistry {
    fn default() -> Self {
        Self::new(300) // 5 minute default timeout
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reg() -> NodeRegistry {
        NodeRegistry::new(60)
    }

    #[test]
    fn register_and_get() {
        let mut r = reg();
        r.register("n1", [0; 20], Platform::IntelSGX, [1; 32], 100)
            .unwrap();
        let node = r.get("n1").unwrap();
        assert_eq!(node.node_id, "n1");
        assert_eq!(node.status, NodeStatus::Registered);
    }

    #[test]
    fn register_duplicate_fails() {
        let mut r = reg();
        r.register("n1", [0; 20], Platform::IntelSGX, [1; 32], 100)
            .unwrap();
        let result = r.register("n1", [0; 20], Platform::IntelSGX, [1; 32], 200);
        assert!(result.is_err());
    }

    #[test]
    fn get_not_found() {
        let r = reg();
        assert!(r.get("missing").is_err());
    }

    #[test]
    fn heartbeat_activates_node() {
        let mut r = reg();
        r.register("n1", [0; 20], Platform::AMDSEV, [1; 32], 100)
            .unwrap();
        r.heartbeat("n1", 200).unwrap();
        assert_eq!(r.get("n1").unwrap().status, NodeStatus::Active);
    }

    #[test]
    fn heartbeat_missing_node() {
        let mut r = reg();
        assert!(r.heartbeat("nope", 100).is_err());
    }

    #[test]
    fn deregister() {
        let mut r = reg();
        r.register("n1", [0; 20], Platform::IntelSGX, [1; 32], 100)
            .unwrap();
        r.deregister("n1").unwrap();
        assert_eq!(r.get("n1").unwrap().status, NodeStatus::Deregistered);
    }

    #[test]
    fn deregister_missing() {
        let mut r = reg();
        assert!(r.deregister("x").is_err());
    }

    #[test]
    fn mark_degraded() {
        let mut r = reg();
        r.register("n1", [0; 20], Platform::IntelSGX, [1; 32], 100)
            .unwrap();
        r.mark_degraded("n1").unwrap();
        assert_eq!(r.get("n1").unwrap().status, NodeStatus::Degraded);
    }

    #[test]
    fn mark_degraded_missing() {
        let mut r = reg();
        assert!(r.mark_degraded("x").is_err());
    }

    #[test]
    fn health_check_marks_stale_offline() {
        let mut r = reg();
        r.register("n1", [0; 20], Platform::IntelSGX, [1; 32], 100)
            .unwrap();
        r.heartbeat("n1", 100).unwrap(); // active
        assert_eq!(r.health_check(200), 1); // 200 - 100 = 100 > 60 timeout
        assert_eq!(r.get("n1").unwrap().status, NodeStatus::Offline);
    }

    #[test]
    fn health_check_keeps_fresh_alive() {
        let mut r = reg();
        r.register("n1", [0; 20], Platform::IntelSGX, [1; 32], 100)
            .unwrap();
        r.heartbeat("n1", 100).unwrap();
        assert_eq!(r.health_check(150), 0);
        assert_eq!(r.get("n1").unwrap().status, NodeStatus::Active);
    }

    #[test]
    fn health_check_degraded_node_goes_offline() {
        let mut r = reg();
        r.register("n1", [0; 20], Platform::IntelSGX, [1; 32], 100)
            .unwrap();
        r.heartbeat("n1", 100).unwrap();
        r.mark_degraded("n1").unwrap();
        assert_eq!(r.health_check(200), 1);
        assert_eq!(r.get("n1").unwrap().status, NodeStatus::Offline);
    }

    #[test]
    fn health_check_skips_registered() {
        let mut r = reg();
        r.register("n1", [0; 20], Platform::IntelSGX, [1; 32], 100)
            .unwrap();
        // Registered, not Active — should not be checked
        assert_eq!(r.health_check(999), 0);
    }

    #[test]
    fn nodes_with_status() {
        let mut r = reg();
        r.register("n1", [0; 20], Platform::IntelSGX, [1; 32], 100)
            .unwrap();
        r.register("n2", [0; 20], Platform::AMDSEV, [2; 32], 100)
            .unwrap();
        r.heartbeat("n1", 100).unwrap();
        assert_eq!(r.nodes_with_status(NodeStatus::Active).len(), 1);
        assert_eq!(r.nodes_with_status(NodeStatus::Registered).len(), 1);
    }

    #[test]
    fn available_nodes() {
        let mut r = reg();
        r.register("n1", [0; 20], Platform::IntelSGX, [1; 32], 100)
            .unwrap();
        r.register("n2", [0; 20], Platform::AMDSEV, [2; 32], 100)
            .unwrap();
        r.heartbeat("n1", 100).unwrap();
        r.heartbeat("n2", 100).unwrap();
        r.mark_degraded("n2").unwrap();
        let avail = r.available_nodes();
        assert_eq!(avail.len(), 2);
    }

    #[test]
    fn total_count() {
        let mut r = reg();
        assert_eq!(r.total_count(), 0);
        r.register("n1", [0; 20], Platform::IntelSGX, [1; 32], 100)
            .unwrap();
        assert_eq!(r.total_count(), 1);
    }

    #[test]
    fn heartbeat_timeout_accessor() {
        let r = reg();
        assert_eq!(r.heartbeat_timeout(), 60);
    }

    #[test]
    fn default_registry() {
        let r = NodeRegistry::default();
        assert_eq!(r.heartbeat_timeout(), 300);
        assert_eq!(r.total_count(), 0);
    }

    #[test]
    fn registry_debug() {
        let r = reg();
        let dbg = format!("{r:?}");
        assert!(dbg.contains("NodeRegistry"));
    }

    #[test]
    fn registry_clone() {
        let mut r = reg();
        r.register("n1", [0; 20], Platform::IntelSGX, [1; 32], 100)
            .unwrap();
        let r2 = r.clone();
        assert_eq!(r.total_count(), r2.total_count());
    }
}
