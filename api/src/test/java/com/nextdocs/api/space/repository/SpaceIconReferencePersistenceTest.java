package com.nextdocs.api.space.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.nextdocs.api.pageicon.PageIconType;
import com.nextdocs.api.space.entity.Space;
import com.nextdocs.api.space.entity.SpaceAccessMode;
import com.nextdocs.api.workspace.entity.Workspace;
import com.nextdocs.api.workspace.repository.WorkspaceRepository;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

/**
 * Guards the icon-reference lookup against the real JPQL. The sweep reads it to keep an
 * upload a space icon still renders, and only a real query shows whether the projected
 * property is selected rather than the whole space row.
 */
@SpringBootTest
class SpaceIconReferencePersistenceTest {

    @Autowired
    private SpaceRepository spaceRepository;

    @Autowired
    private WorkspaceRepository workspaceRepository;

    @Test
    void listsUploadIconValuesTheWorkspacesSpacesRender() {
        Workspace workspace = workspaceRepository.saveAndFlush(
                Workspace.builder().name("NextDocs").build());
        UUID iconId = UUID.randomUUID();
        spaceRepository.saveAndFlush(Space.builder()
                .workspace(workspace)
                .name("Engineering")
                .accessMode(SpaceAccessMode.CUSTOM)
                .iconType(PageIconType.UPLOAD)
                .iconValue(iconId.toString())
                .build());
        spaceRepository.saveAndFlush(Space.builder()
                .workspace(workspace)
                .name("Design")
                .accessMode(SpaceAccessMode.CUSTOM)
                .iconType(PageIconType.EMOJI)
                .iconValue("🚀")
                .build());

        assertThat(spaceRepository.findIconValueByWorkspace_IdAndIconType(workspace.getId(), PageIconType.UPLOAD))
                .containsExactly(iconId.toString());
    }
}
