---
version: 1.0
updatedAt: 2026-09-08
title: "Estágios do Pipeline de CI/CD e Builds Containerizados"
summary: "Um pipeline de CI/CD real é uma sequência estrita de estágios com portões, build, teste automatizado, empacotar, implantar, ordenada deliberadamente para que cada estágio pegue a classe mais barata de problema que consegue pegar antes de estágios mais caros rodarem; o estágio de empacotar numa imagem de contêiner é o que torna o artefato testado e o artefato implantado comprovadamente idênticos."
---
## Objetivos de Aprendizagem

- Rastrear um commit real pelos quatro estágios de um pipeline de CI/CD concreto: build, teste automatizado, empacotar, implantar.
- Explicar por que cada estágio é ordenado para falhar rápido e barato na classe de problema que ele está mais bem posicionado para pegar, e por que reordenar os estágios perde essa propriedade.
- Explicar por que empacotar numa imagem de contêiner é o passo que torna o artefato testado e o artefato implantado comprovadamente idênticos.
- Conectar o estágio de empacotamento em contêiner diretamente a `containers-and-os-level-virtualization`, em vez de tratar "containerizar o build" como uma caixa-preta inexplicada.

## Contexto e Motivação

`continuous-integration` e `continuous-delivery-and-continuous-deployment` estabeleceram o que o CI/CD é e onde o ponto de decisão humano se situa. Este conceito torna o próprio pipeline concreto: a sequência de fato de estágios com portões pelos quais um commit real passa, e por que essa sequência é ordenada da forma que é, não arbitrariamente. O estágio específico que este conceito trata com a maior profundidade, empacotar a aplicação numa imagem de contêiner, é também o primeiro vínculo cruzado direto e concreto desta disciplina com o próprio material de contêiner de `systems/operating-systems-ii`, conectando duas disciplinas que, na superfície, parecem não relacionadas.

## Teoria Central

### O pipeline de quatro estágios, e por que a ordem importa

Um pipeline de CI/CD real não é um checklist arbitrário; cada estágio existe para pegar uma classe específica de problema tão barato quanto possível, e a ordenação deliberadamente põe checagens mais baratas e rápidas antes das mais caras e lentas:

```mermaid
graph LR
    A[Commit enviado\npara a linha principal] --> B[Build:\ncompilar, resolver dependências]
    B --> C[Teste automatizado:\nunitário, depois integração, por\npirâmide de testes]
    C --> D[Empacotar:\nconstruir uma imagem de contêiner]
    D --> E[Implantar:\nlançar a imagem para um\nambiente]
```

```text
1. BUILD:    Pega a classe mais barata de problema (código que
             nem compila, uma dependência faltante) antes de
             gastar qualquer tempo rodando um único teste contra ele.

2. TESTE:    Pega erros de lógica, rodados na ordem em camadas que
             a pirâmide de testes (test-pyramid-strategy) já
             prescreve: testes unitários rápidos primeiro, testes
             de integração mais lentos depois, para que uma falha
             de teste rápida e barata seja reportada antes de uma
             lenta e cara sequer ter uma chance de rodar e consumir tempo.

3. EMPACOTAR: Produz um único artefato imutável (uma
             imagem de contêiner) a partir de código que já passou
             por todo estágio anterior, para que nada que aconteça depois
             deste ponto possa introduzir uma discrepância entre o que
             foi testado e o que é implantado.

4. IMPLANTAR: Lança esse artefato exato e já testado para um
             ambiente, usando uma das estratégias que
             deployment-strategies-blue-green-and-canary cobre
             em seguida.
```

Reverter esta ordem, empacotar antes de testar, por exemplo, significaria que uma falha de teste descoberta depois do empacotamento desperdiça o tempo gasto construindo o pacote para uma mudança que nunca ia a lugar nenhum; reordená-la de qualquer outra forma perde a propriedade de falhar-rápido em torno da qual a sequência é deliberadamente construída.

### Por que empacotar num contêiner torna o artefato comprovadamente idêntico

Antes de a containerização ser prática padrão, um modo de falha real e comum assolava os pipelines de implantação: código que passava por todo teste num ambiente de CI ainda podia falhar uma vez implantado, porque o ambiente de CI e o ambiente de produção diferiam em algum detalhe que nenhum dos lados tinha contabilizado, uma biblioteca de sistema faltante, uma versão de runtime diferente, um layout de sistema de arquivos diferente. Uma imagem de contêiner, construída uma vez durante o estágio de empacotamento e nunca reconstruída depois, elimina esta classe inteira de falha por construção: a exata mesma imagem que rodou os testes automatizados (ou uma imagem construída a partir da exata mesma fonte e grafo de dependências já testados) é a exata mesma imagem implantada em todo ambiente posterior, staging e produção igualmente. `containers-and-os-level-virtualization` (`systems/operating-systems-ii`) explica o mecanismo subjacente, namespaces e cgroups fornecendo isolamento de processo sem a sobrecarga de uma máquina virtual completa, que torna este tipo de imagem portável e autocontida prático de construir e rodar rápido o bastante para caber dentro do próprio orçamento de tempo de um pipeline de CI/CD.

### Portões entre estágios, não só estágios

Cada seta no diagrama do pipeline é um portão, não meramente um marcador de sequência: um commit que falha o estágio de build nunca alcança o estágio de teste de todo, e um commit que falha qualquer teste nunca alcança o empacotamento. Este uso de portões é exatamente o que torna a propriedade de falhar-rápido real em vez de aspiracional; sem ele, um pipeline que roda todo estágio independentemente de falhas anteriores ainda eventualmente reportaria as mesmas falhas, só que depois de desperdiçar o tempo e os recursos que todo estágio posterior consumiu numa mudança já sabida estar quebrada.

## Exemplos Resolvidos

### Exemplo 1: um commit pego no estágio mais barato possível

Um desenvolvedor envia um commit com um erro de digitação numa declaração de import. O estágio de build falha em segundos, antes de um único teste rodar, e o desenvolvedor é notificado imediatamente. Tivesse o teste rodado antes do build (uma ordem invertida e incorreta), o pipeline teria de de alguma forma tentar rodar testes contra código que nem compila, o que simplesmente não é possível; a ordenação natural e correta existe precisamente porque as checagens de cada estágio são sem sentido sem o sucesso do estágio anterior como uma pré-condição.

### Exemplo 2: uma imagem de contêiner eliminando uma classe de bug "funciona na minha máquina"

Uma equipe migra de implantar diretamente do sistema de arquivos local de um servidor de build para empacotar todo build numa imagem de contêiner antes da implantação. Três semanas depois, um bug que tinha aparecido intermitentemente só em produção, rastreado eventualmente a uma versão sutilmente diferente de uma biblioteca de sistema presente nos servidores de produção mas não no servidor de build de CI, para de reocorrer inteiramente, porque a imagem de contêiner agora carrega as suas próprias dependências de runtime exatas com ela para todo ambiente, staging e produção igualmente, em vez de depender do que por acaso já estivesse instalado na máquina rodando-a.

### Exemplo 3: um portão corretamente parando uma mudança ruim antes de ela alcançar o empacotamento

Um teste de integração no estágio de teste automatizado falha para um commit específico, corretamente detectando uma regressão real em como dois serviços agora interagem depois da mudança. Porque o pipeline usa portões estritamente (Teoria Central), o estágio de empacotamento nunca roda para este commit; nenhuma imagem de contêiner é jamais construída a partir do código quebrado, e nenhum estágio de implantação jamais tem a oportunidade de considerar lançá-lo. A regressão é pega e parada dois estágios antes de ela poder ter alcançado um ambiente real, no exato estágio projetado para pegar exatamente esta classe de problema.

## Equívocos Comuns e Armadilhas

- **"A ordem dos estágios do pipeline não importa realmente, desde que tudo eventualmente rode."** O Exemplo 1 mostra que alguns estágios são logicamente dependentes de os anteriores terem sucesso (testar código que não compila não é significativo); a ordem específica na Teoria Central não é uma convenção arbitrária, ela reflete dependências reais e estruturais entre o que cada estágio checa.
- **"Uma imagem de contêiner é só uma máquina virtual mais leve, nada mais."** `containers-and-os-level-virtualization` já traça esta distinção precisamente (namespaces e cgroups fornecendo isolamento sem um hipervisor); o próprio ponto deste conceito é mais estreito mas tão real: o valor da imagem num pipeline é especificamente que ela é um artefato imutável e portável carregando as suas próprias dependências de runtime, eliminando bugs de incompatibilidade de ambiente como o do Exemplo 2, independentemente de exatamente quão leve é o mecanismo de isolamento por baixo dela.
- **"Usar portões entre estágios só significa rodar estágios em sequência."** Uma sequência sem um portão real ainda rodaria todo estágio posterior mesmo depois de um anterior falhar, desperdiçando os recursos que esses estágios posteriores consomem; o valor de fato do Exemplo 3 depende de o pipeline genuinamente parar, não meramente reportar uma falha depois de tudo o mais já ter rodado de qualquer forma.

## Resumo

Um pipeline de CI/CD real é uma sequência estrita de estágios com portões, build, teste automatizado, empacotar, implantar, ordenada deliberadamente para que cada estágio pegue a classe mais barata de problema que ele é capaz de pegar antes de estágios mais caros e lentos sequer rodarem, e com portões estritos para que uma falha em qualquer estágio pare o commit de prosseguir em vez de meramente ser reportada depois de todo estágio posterior já ter rodado de qualquer forma. O estágio de empacotamento, construindo o código testado numa imagem de contêiner, é o passo que finalmente torna o artefato que foi testado e o artefato que é implantado comprovada e exatamente idênticos, eliminando uma classe real inteira de bugs de incompatibilidade de ambiente por construção; `containers-and-os-level-virtualization` (`systems/operating-systems-ii`) explica o mecanismo de isolamento subjacente, namespaces e cgroups, que torna construir e rodar tal imagem prático dentro do próprio orçamento de tempo de um pipeline.

## Documentation Links

- [IEEE Computer Society: SWEBOK v4.0 Guide](https://www.computer.org/education/bodies-of-knowledge/software-engineering): a área de conhecimento de Operações de Engenharia de Software à qual o tratamento de estágio de pipeline deste conceito pertence.
- [Fowler: Continuous Integration](https://martinfowler.com/articles/continuousIntegration.html): inclui "automatizar a implantação" entre as suas práticas centrais, a origem de tratar a própria implantação como o estágio final e automatizável do mesmo pipeline que começa com um build automatizado.
