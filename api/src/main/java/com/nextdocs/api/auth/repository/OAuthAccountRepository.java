package com.nextdocs.api.auth.repository;

import com.nextdocs.api.auth.entity.OAuthAccount;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface OAuthAccountRepository extends JpaRepository<OAuthAccount, UUID> {

    Optional<OAuthAccount> findByProviderAndProviderUserId(String provider, String providerUserId);
}
