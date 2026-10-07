import { describe, it, expect } from 'vitest';
import { AlgorithmsConceptsService } from '../src/algorithms-concepts/algorithms-concepts.service';
import { CurriculumService } from '../src/curriculum/curriculum.service';
import { DatabaseConceptsService } from '../src/database-concepts/database-concepts.service';
import { JavaConceptsService } from '../src/java-concepts/java-concepts.service';
import { JavaMinuteService } from '../src/java-minute/java-minute.service';
import { CSharpMinuteService } from '../src/csharp-minute/csharp-minute.service';
import { JvmConceptsService } from '../src/jvm-concepts/jvm-concepts.service';
import { KubernetesConceptsService } from '../src/kubernetes-concepts/kubernetes-concepts.service';
import { QuarkusConceptsService } from '../src/quarkus-concepts/quarkus-concepts.service';
import { RubyConceptsService } from '../src/ruby-concepts/ruby-concepts.service';
import { RubyOnRailsConceptsService } from '../src/rubyonrails-concepts/rubyonrails-concepts.service';
import { DotNetConceptsService } from '../src/dotnet-concepts/dotnet-concepts.service';
import { CSharpConceptsService } from '../src/csharp-concepts/csharp-concepts.service';
import { DotNetTestingConceptsService } from '../src/dotnet-testing-concepts/dotnet-testing-concepts.service';
import { SearchService, toPlainText } from '../src/search/search.service';
import { SpringConceptsService } from '../src/spring-concepts/spring-concepts.service';
import { SystemDesignConceptsService } from '../src/system-design-concepts/system-design-concepts.service';
import { TestingConceptsService } from '../src/testing-concepts/testing-concepts.service';
import { SUPPORTED_LANGUAGES } from '../src/shared/language';

function buildDocuments() {
  return new SearchService(
    null as never,
    null as never,
    new JavaConceptsService(),
    new JvmConceptsService(),
    new JavaMinuteService(),
    new CSharpMinuteService(),
    new CurriculumService(),
    new DatabaseConceptsService(),
    new SpringConceptsService(),
    new SystemDesignConceptsService(),
    new TestingConceptsService(),
    new AlgorithmsConceptsService(),
    new RubyConceptsService(),
    new RubyOnRailsConceptsService(),
    new DotNetConceptsService(),
    new CSharpConceptsService(),
    new DotNetTestingConceptsService(),
    new QuarkusConceptsService(),
    new KubernetesConceptsService(),
    null as never,
  ).buildContentDocuments();
}

describe('search documents', () => {
  const documents = buildDocuments();
  const pages = new Set(documents.map((doc) => doc.url));

  it('has unique ids', () => {
    expect(new Set(documents.map((doc) => doc.id)).size).toBe(documents.length);
  });

  it('makes every page visible exactly once in every language', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      const visible = documents.filter((doc) => doc.visibleIn.includes(lang));
      expect(visible.length).toBe(pages.size);
      expect(new Set(visible.map((doc) => doc.url)).size).toBe(pages.size);
    }
  });

  it('indexes translations of every track, not only some of them', () => {
    const translatedTypes = new Set(
      documents.filter((doc) => doc.language !== 'en').map((doc) => doc.type),
    );
    expect(translatedTypes).toContain('database-concept');
    expect(translatedTypes).toContain('curriculum-concept');
    expect(translatedTypes).toContain('system-design-concept');
  });

  it('keeps the original title searchable on a translated document', () => {
    const translated = documents.find(
      (doc) => doc.language === 'pt-BR' && doc.altTitle,
    );
    const original = documents.find(
      (doc) => doc.url === translated?.url && doc.language === 'en',
    );
    expect(translated?.altTitle).toBe(original?.title);
  });
});

describe('toPlainText', () => {
  it('drops markdown markup but keeps code and link text', () => {
    expect(
      toPlainText(
        '## Deep Dive\n\n- **Bold** [link](https://x)\n```java\nint a = 1;\n```',
      ),
    ).toBe('Deep Dive Bold link int a = 1;');
  });
});
