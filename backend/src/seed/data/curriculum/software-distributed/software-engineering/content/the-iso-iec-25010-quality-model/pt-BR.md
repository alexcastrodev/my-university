---
version: 1.0
updatedAt: 2026-11-03
title: "O Modelo de Qualidade ISO/IEC 25010"
summary: "O modelo de qualidade de produto da ISO/IEC 25010:2023, com suas nove características, o que a revisão de 2023 mudou em relação a 2011 (inclusive a saída do modelo de qualidade em uso) e como uma característica de qualidade vira um requisito mensurável."
---
## Objetivos de Aprendizagem

- Nomear as nove características de qualidade de produto da ISO/IEC 25010:2023 e dizer quais foram acrescentadas ou renomeadas em relação à edição de 2011.
- Explicar o que aconteceu com o modelo de qualidade em uso, que anotações de curso mais antigas ainda atribuem à ISO/IEC 25010.
- Transformar uma característica de qualidade em um requisito verificável: uma subcaracterística, uma medida, um limite e um método de medição.
- Separar o que o material gratuito sobre a norma mostra do que só o texto comprado mostra.

## Contexto e Motivação

`functional-vs-non-functional-requirements` terminou dizendo que os requisitos não funcionais caem em categorias conhecidas e que nomear a categoria ajuda a escrever o requisito com precisão. Aquela lição usou os nomes das categorias (desempenho, confiabilidade, segurança, manutenibilidade) de modo informal. Esta lição apresenta o vocabulário formal por trás desses nomes, o modelo de qualidade de produto da ISO/IEC 25010, com um aviso.

O aviso é que esta é uma norma datada. A ISO/IEC 25010 surgiu em 2011 e foi substituída em novembro de 2023. Livros, slides e muitas páginas na web ainda listam as características de 2011, incluindo "usabilidade" e "portabilidade", que deixaram de ser características de nível superior. Quem decora a lista antiga escreve requisitos contra um modelo que a ISO retirou. Por isso esta lição ensina a edição atual e marca o que as listas antigas dizem como "livro versus hoje".

O texto completo da norma é vendido, então a última parte da Teoria Central diz o que o material gratuito mostra e o que não mostra.

## Teoria Central

### Para que serve a norma

A ISO/IEC 25010:2023 se intitula "Systems and software engineering, Systems and software Quality Requirements and Evaluation (SQuaRE), Product quality model". É a segunda edição e substitui a ISO/IEC 25010:2011. O escopo diz que o modelo se aplica a produtos de TIC e a produtos de software e que é "composto de nove características (que se subdividem em subcaracterísticas)". Ele lista usos como levantar requisitos, definir objetivos de teste e definir critérios de aceitação.

O modelo é um vocabulário de referência, para que duas pessoas que dizem "confiabilidade" queiram dizer a mesma coisa. Ele não diz quanto de cada qualidade um produto precisa; isso pertence ao processo de requisitos.

### As nove características do modelo de qualidade de produto de 2023

```text
1. Functional suitability   functional completeness, functional correctness,
                            functional appropriateness
2. Performance efficiency   time behaviour, resource utilization, capacity
3. Compatibility            co-existence, interoperability
4. Interaction capability   appropriateness recognizability, learnability,
                            operability, user error protection, user
                            engagement, inclusivity, user assistance,
                            self-descriptiveness
5. Reliability              faultlessness, availability, fault tolerance,
                            recoverability
6. Security                 confidentiality, integrity, non-repudiation,
                            accountability, authenticity, resistance
7. Maintainability          modularity, reusability, analysability,
                            modifiability, testability
8. Flexibility              adaptability, scalability, installability,
                            replaceability
9. Safety                   operational constraint, risk identification,
                            fail safe, hazard warning, safe integration
```

Dois detalhes passam batido com facilidade. Primeiro, a adequação funcional (functional suitability) é ela própria uma característica de qualidade: a norma a define como a capacidade de um produto de fornecer "funções que atendam às necessidades declaradas e implícitas dos usuários pretendidos" quando usado sob condições especificadas, uma dimensão entre nove, com completude, correção e adequação como subcaracterísticas. Segundo, a subcaracterística "capacity" é definida como atender aos requisitos para os limites máximos de um parâmetro do produto, com o número de usuários simultâneos como exemplo.

### O que mudou desde 2011 (livro versus hoje)

O prefácio da edição de 2023 lista as próprias mudanças, então elas podem ser afirmadas com segurança:

- Safety (segurança operacional, no sentido de evitar dano) foi acrescentada como característica, com cinco subcaracterísticas.
- Usability e portability foram substituídas por interaction capability e flexibility.
- Inclusivity e self-descriptiveness, resistance e scalability foram acrescentadas como subcaracterísticas de interaction capability, security e flexibility.
- User interface aesthetics e maturity foram substituídas por user engagement e faultlessness.
- Accessibility foi dividida em inclusivity e user assistance.

O total de oito em 2011 não está impresso no prefácio; ele decorre dessas mudanças, enquanto a contagem de nove em 2023 vem declarada no escopo.

### Para onde foi a qualidade em uso

Fontes antigas descrevem a ISO/IEC 25010 como dois modelos: qualidade de produto e qualidade em uso. O prefácio de 2023 diz que as demais partes do documento de 2011 foram movidas para a ISO/IEC 25002 (visão geral e uso dos modelos de qualidade) e para a ISO/IEC 25019 (o modelo de qualidade em uso). A descrição de catálogo da ISO/IEC 25019:2023 diz que ela define um modelo de qualidade em uso composto de três características. Um resumo de terceiros no arc42 as nomeia como beneficialness, freedom from risk e acceptability; é uma fonte secundária, já que o texto da norma é vendido.

O modelo de produto descreve propriedades da coisa que você constrói; o modelo de qualidade em uso descreve resultados quando pessoas reais a usam em um contexto real. A edição de 2023 diz que a interaction capability é "um pré-requisito para a usabilidade", que por sua vez é julgada pela eficácia, eficiência e satisfação do uso real.

### Da característica ao requisito

"O sistema deve ser confiável" não pode falhar em nenhum teste. Um requisito de qualidade verificável tem quatro partes:

1. A subcaracterística que ele restringe (disponibilidade, e não só "confiabilidade").
2. Uma medida (a fração do tempo em que o serviço está operacional e acessível quando necessário para uso, que é como a listagem do ISO 25000 descreve disponibilidade).
3. Um limite (pelo menos 99,9% em um mês-calendário).
4. Um método de medição (o que é contado, em que janela e como qualquer estatística é calculada).

A norma tem um anexo sobre o uso do modelo para medição, e a família SQuaRE tem uma divisão própria de medição da qualidade, onde ficam as medidas em si. Esta lição cobre apenas a estrutura de quatro partes, que os exemplos exercitam.

### O que é público e o que é vendido

O texto completo da norma é vendido. O material gratuito cobre três coisas: o registro de catálogo da ISO; um preview da editora com o escopo, o prefácio, o sumário e as primeiras definições (functional suitability, performance efficiency, compatibility e o início de interaction capability); e uma listagem de terceiros em iso25000.com com os nomes de todas as características e subcaracterísticas e uma definição curta de cada uma. Essa listagem redige as definições como "degree to which ..." (grau em que), diferente do "capability of a product to ..." da própria norma, então serve de guia para o sentido e não como citação da norma. As definições usadas nos exemplos abaixo vêm dessa listagem e estão indicadas como tal. Só o texto comprado mostra as definições da própria norma para as demais características, a comparação do Anexo A com 2011 e o anexo de medição.

## Exemplos Resolvidos

### Exemplo 1: classificando requisitos da lição anterior

```text
"E-mails de redefinição entregues em até 60 s, 95% das vezes" -> Performance efficiency / time behaviour
"Pelo menos 50.000 sessões ativas simultâneas"                -> Performance efficiency / capacity
"Senhas armazenadas com hash, nunca em texto puro"            -> Security / confidentiality
"Continuar disponível durante a queda de um data center"      -> Reliability / availability
"Adicionar um provedor de pagamento sem modificar o código
 existente dos provedores"                                    -> Maintainability / modifiability
```

As três primeiras linhas vêm do lote de classificação da lição anterior; as duas últimas são os exemplos de declarações não funcionais dela. A lição anterior chamou a declaração das 50.000 sessões de escalabilidade. No modelo de 2023 essa palavra é uma subcaracterística de flexibility, e a listagem do ISO 25000 descreve a escalabilidade como lidar com cargas crescentes ou decrescentes ou adaptar a capacidade à variabilidade. Um máximo fixo como 50.000 usuários simultâneos corresponde, em vez disso, à definição de capacity da norma. "Precisa crescer de 50.000 para 500.000 conforme o negócio cresce" seria escalabilidade. A listagem descreve confidencialidade como dados acessíveis apenas a quem está autorizado, disponibilidade como estar operacional e acessível quando necessário para uso, e modificabilidade como poder ser modificado de forma eficaz e eficiente sem introduzir defeitos nem degradar a qualidade existente do produto. Isso combina com as linhas 3 e 4. A linha 5 é o caso mais apertado: a cláusula sobre não alterar o código existente dos provedores também lembra a modularidade da listagem, em que a mudança num componente tem impacto mínimo nos outros, então modificabilidade é uma escolha defensável, não a única.

### Exemplo 2: uma proporção, um percentil e a média

Um time escreve: "O endpoint de busca responde em até 300 ms para 95% das requisições." Eles amostram 20 latências (ms): 112, 98, 130, 121, 105, 99, 140, 118, 126, 102, 95, 110, 133, 108, 250, 119, 101, 124, 640, 115. Um script dá média de 147,3, mediana de 116,5 e máximo de 640. Exatamente 19 das 20 requisições amostradas (95%) ficam em 300 ms ou menos, então a amostra atende à proporção sem nenhum estimador de percentil envolvido, mas só na margem: mais uma requisição lenta o quebraria. A amostra não é o serviço, porém. O intervalo de confiança exato de 95% para 19 de 20 vai de cerca de 75% a 99,9%, então o requisito também precisa dizer quais requisições cobre, por exemplo todas as de uma janela declarada.

Suponha que o time reescreva como "o percentil 95 é no máximo 300 ms". Agora o estimador importa, porque é preciso calcular um percentil de 20 valores. A interpolação linear dá 269,5 ms. O método do posto mais próximo toma o ceil(0,95 x 20) = 19º valor ordenado, 250 ms. O `method="higher"` do NumPy parte da posição com índice zero (n - 1) x 0,95 = 18,05 e toma o próximo valor ordenado acima, o 20º, que é 640 ms. Os dois primeiros passam e o terceiro reprova, com os mesmos dados, porque os métodos diferem na posição que calculam (o posto mais próximo usa outra fórmula) e em como resolvem uma posição fracionária (a linear interpola entre os vizinhos, e `higher` salta para o de cima). Duas lições decorrem disso. Escreva o requisito como proporção, ou nomeie o estimador se usar um percentil. E não substitua pela média: 147,3 ms esconde a requisição de 640 ms. A amostra erraria uma meta de "99% abaixo de 300 ms", e 20 amostras são poucas para sustentar uma afirmação de 99% de qualquer jeito.

### Exemplo 3: um orçamento de disponibilidade

Em um mês de 30 dias, um script dá estas folgas de indisponibilidade: 99,5% permite 216 minutos, 99,9% permite 43,2 minutos e 99,99% permite cerca de 4,3 minutos. Em um ano de 365 dias, 99,9% permite 8,76 horas.

Os dois cálculos a seguir supõem que as falhas dos componentes são independentes, o que é uma suposição forte. Para componentes em série, as disponibilidades se multiplicam: dois componentes com 99,9% cada dão 0,999 x 0,999 = 0,998001, cerca de 86,4 minutos de indisponibilidade em 30 dias, o dobro dos 43,2 minutos que cada parte sozinha permite. Para duas réplicas com 99% cada, em que qualquer uma basta, as indisponibilidades se multiplicam: 1 - 0,01 x 0,01 = 99,99%. Um requisito de "99,9% de disponibilidade" que não diz se vale para um componente ou para todo o caminho visível ao usuário é ambíguo exatamente assim.

### Exemplo 4: migrando um documento de requisitos antigo

Uma especificação de 2019 tem uma seção "Usabilidade: o sistema deve ser acessível a usuários com deficiência." No modelo de 2023, usabilidade deixou de ser característica de produto e accessibility foi dividida em inclusivity e user assistance. O requisito não pode ser simplesmente transposto: precisa ser relido contra os dois novos nomes e contra a característica interaction capability sob a qual eles ficam. Se ele vira um requisito ou dois depende do que os stakeholders queriam dizer com "acessível". A migração força um esclarecimento que a palavra antiga, mais grossa, escondia.

## Equívocos Comuns e Armadilhas

- **"A ISO/IEC 25010 tem oito características, incluindo usabilidade e portabilidade."** Essa é a edição de 2011, já substituída. O modelo de qualidade de produto atual tem nove, com interaction capability, flexibility e safety.
- **"A 25010 contém o modelo de qualidade em uso."** Em 2011 continha. Em 2023 esse modelo foi para a ISO/IEC 25019, como o prefácio declara.
- **"Um requisito está pronto quando nomeia uma característica."** O Exemplo 2 mostra dados que atendem a um requisito de proporção e podem reprovar o mesmo requisito reescrito como percentil com estimador não nomeado. Ele precisa de medida, limite, a população que cobre e um método que não deixe essa escolha em aberto.
- **"Maximize as nove."** As características se compensam (segurança rígida pode custar time behaviour), então uma especificação define prioridades, e os níveis vêm dos stakeholders e do risco, não da norma.

## Resumo

A ISO/IEC 25010:2023 define nove características de qualidade de produto: functional suitability, performance efficiency, compatibility, interaction capability, reliability, security, maintainability, flexibility e safety. Em relação a 2011, acrescenta safety, troca usability e portability por interaction capability e flexibility e move o modelo de qualidade em uso para a ISO/IEC 25019, de modo que anotações antigas descrevem uma edição retirada. Uma característica só vira requisito com subcaracterística, medida, limite e método de medição, como os exemplos mostram. O texto completo é vendido; o material gratuito mostra o escopo, o prefácio, o sumário, as primeiras definições e os nomes e definições curtas de todas as subcaracterísticas.

## Documentation Links

- [ISO: ISO/IEC 25010:2023 catalog page](https://committee.iso.org/standard/78176.html): o registro oficial da edição, sua data de publicação, seu status e a declaração de que ela substitui a ISO/IEC 25010:2011.
- [ISO/IEC 25010:2023 publisher preview (iTeh)](https://cdn.standards.iteh.ai/samples/78176/13ff8ea97048443f99318920757df124/ISO-IEC-25010-2023.pdf): as páginas de preview, incluindo a lista de mudanças do prefácio, o sumário, o escopo e as primeiras definições.
- [ISO 25000: ISO/IEC 25010 characteristics and sub-characteristics](https://iso25000.com/index.php/en/iso-25000-standards/iso-25010): uma listagem pública das nove características e suas subcaracterísticas com definições curtas, redigidas de forma diferente da própria norma.
- [arc42 Quality Model: update on ISO 25010, version 2023](https://quality.arc42.org/articles/iso-25010-update-2023): um resumo de praticante sobre o que a edição de 2023 acrescentou, renomeou e dividiu.
- [IEC Webstore: ISO/IEC 25019:2023 Quality-in-use model](https://webstore.iec.ch/publication/90105): a descrição de catálogo da norma que agora abriga o modelo de qualidade em uso.
- [arc42 Quality Model: ISO 25019](https://quality.arc42.org/standards/iso-25019): um resumo de terceiros das três características de qualidade em uso e de suas subcaracterísticas.
