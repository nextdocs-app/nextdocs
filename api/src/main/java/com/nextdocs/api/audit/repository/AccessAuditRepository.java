package com.nextdocs.api.audit.repository;

import com.nextdocs.api.audit.entity.AccessAudit;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface AccessAuditRepository extends JpaRepository<AccessAudit, UUID> {}
